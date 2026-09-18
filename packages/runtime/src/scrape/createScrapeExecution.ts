import { basename, dirname } from "node:path";
import { filesystemPathKey, type MediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import type { Configuration } from "@mdcz/shared/config";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { ScrapeResult } from "@mdcz/shared/types";
import { mediaPathOwnership } from "../library/mediaPathOwnership";
import { commitScrapeTerminalResults } from "../publication/commitScrapeTerminalResult";
import { prepareMediaPathKeys } from "../publication/paths";
import { resolveScrapeAttempts, resolveScrapeRetry } from "../tasks/session/resolveScrapeRetry";
import type { ScrapeRunExecution, ScrapeRunItem } from "../tasks/session/ScrapeRunSession";
import { toScrapeResultFromOutcome } from "../tasks/session/scrapeRunSnapshotDto";
import type { DirectoryInventory } from "./DirectoryInventory";
import { buildScrapePublicationKey } from "./FileOrganizer";
import type { PreparedFileScrape, ScrapeGroupResult } from "./FileScraper";
import { checkScrapeTargets } from "./preflightScrapeTask";
import { parseFileInfo } from "./utils/number";

export async function createScrapeExecution<TManual, TPrepared>(input: {
  configuration: Configuration;
  inventory: DirectoryInventory;
  ownership(): readonly {
    rootId: string;
    relativePath: string;
    movieId: string;
    fileId: string | null;
    kind: "video" | "nfo" | "strm";
  }[];
  manifest: {
    id: string;
    executionGeneration: number;
    items: readonly (RootFileRef & { id: string })[];
    attempts: readonly { id: string; itemId: string }[];
    outcomes: readonly (Parameters<typeof toScrapeResultFromOutcome>[1] & { attemptId: string })[];
    requestedOutputRelativeDirectory: string | null;
  };
  outputRoot?: MediaRoot;
  resolveRoot(id: string): Promise<MediaRoot>;
  enrichItem(item: ScrapeRunItem<TManual>): ScrapeRunItem<TManual> | Promise<ScrapeRunItem<TManual>>;
  manualScrape(itemId: string): TManual | undefined;
  fileScrape(prepared: TPrepared): PreparedFileScrape;
  execution: Pick<ScrapeRunExecution<TManual, TPrepared>, "concurrency" | "prepareGroup"> & {
    executePreparedFiles(
      entries: readonly { item: ScrapeRunItem<TManual>; prepared: TPrepared; fileScrape: PreparedFileScrape }[],
      signal: AbortSignal,
    ): Promise<ScrapeGroupResult>;
  };
  restGate?: { waitBeforeStart(signal?: AbortSignal): Promise<void> };
  publication: Omit<Parameters<typeof commitScrapeTerminalResults>[0], "acquireAll" | "items" | "publicationPlan">;
  admitAttempt(itemId: string): { id: string };
  transformResult?(item: ScrapeRunItem<TManual>, result: ScrapeResult): ScrapeResult;
  onCommitted?(result: ScrapeResult): void;
}): Promise<ScrapeRunExecution<TManual, TPrepared>> {
  const { manifest } = input;
  const { openAttemptByItemId, latestOutcomeByItemId } = resolveScrapeAttempts(manifest);
  const items = await Promise.all(
    manifest.items.map(async (item) => {
      const execution = await resolveScrapeRetry({
        item,
        retrying: openAttemptByItemId.has(item.id),
        latestOutcome: latestOutcomeByItemId.get(item.id),
        outputRoot: input.outputRoot ?? (await input.resolveRoot(item.rootId)),
        outputRelativeDirectory: manifest.requestedOutputRelativeDirectory ?? "",
        resolveRoot: input.resolveRoot,
      });
      return await input.enrichItem({ ...item, ...execution, manualScrape: input.manualScrape(item.id) });
    }),
  );
  const locations = await Promise.all(
    input.ownership().map(async (entry) => ({
      ...entry,
      path: await input.inventory.entryPath(
        resolveRootRelativePath(await input.resolveRoot(entry.rootId), entry.relativePath),
      ),
    })),
  );
  const owners = new Map<string, string>();
  for (const file of locations) {
    const identity = filesystemPathKey(file.path);
    if (file.kind === "strm") {
      input.inventory.generatedStrms.add(identity);
      continue;
    }
    if (file.kind !== "video") continue;
    const previous = owners.get(identity);
    if (previous && previous !== file.movieId) throw new Error(`Media entry belongs to multiple movies: ${file.path}`);
    owners.set(identity, file.movieId);
    input.inventory.registeredNfos.set(
      identity,
      locations
        .filter(
          (asset) =>
            asset.kind === "nfo" &&
            asset.movieId === file.movieId &&
            (asset.fileId === null || asset.fileId === file.fileId),
        )
        .map((asset) => asset.path),
    );
  }
  const movieGroups = new Map<string, { itemIds: string[]; movieId?: string; error?: string }>();
  const observed = new Map<string, { number: string; part?: number }[]>();
  for (const item of items) {
    const entryPath = await input.inventory.entryPath(item.sourcePath);
    const entryIdentity = filesystemPathKey(entryPath);
    const movieId = owners.get(entryIdentity);
    const fileInfo = parseFileInfo(item.sourcePath, input.configuration.scrape.filenameIgnoreTokens);
    const key =
      movieId ?? `${filesystemPathKey(dirname(entryPath))}\0${fileInfo.number.trim().toUpperCase() || entryIdentity}`;
    const group = movieGroups.get(key) ?? { itemIds: [], movieId };
    group.itemIds.push(item.id);
    const members = observed.get(key) ?? [];
    members.push({ number: fileInfo.number, part: fileInfo.part?.number });
    observed.set(key, members);
    if (!movieId) {
      const parts = members.flatMap((member) => (member.part === undefined ? [] : [member.part]));
      if (parts.length && parts.length !== members.length)
        group.error = "同一影片同时包含分盘文件和独立文件，需要手动核对";
      if (new Set(parts).size !== parts.length) group.error = "同一影片存在重复分盘号，需要手动核对";
    }
    const primary = await input.inventory.mediaEntries(dirname(item.sourcePath));
    if (
      fileInfo.extension.toLowerCase() === ".strm" &&
      !primary.some((entry) => entry.name === basename(item.sourcePath))
    )
      group.error = `不能单独刮削生成的媒体附属文件：${item.sourcePath}`;
    movieGroups.set(key, group);
  }
  return {
    concurrency: input.execution.concurrency,
    movieGroups: [...movieGroups.values()],
    prepareGroup: async (entries, signal) => {
      await input.restGate?.waitBeforeStart(signal);
      const results = await input.execution.prepareGroup(entries, signal);
      const movieId = [...movieGroups.values()].find((group) => group.itemIds.includes(entries[0].item.id))?.movieId;
      for (const result of results)
        if (result.status === "prepared") input.fileScrape(result.prepared).groupMovieId = movieId;
      return results;
    },
    executePreparedItems: async (entries, signal) => {
      const group = await input.execution.executePreparedFiles(
        entries.map(({ item, prepared, attemptId }) => {
          const file = input.fileScrape(prepared);
          return {
            item,
            prepared,
            fileScrape: {
              ...file,
              attemptId,
              identity: { ...file.identity, fileId: item.id, rootId: item.rootId, relativePath: item.relativePath },
            },
          };
        }),
        signal,
      );
      return { ...group, results: group.results.map((result) => ({ itemId: result.fileId, result })) };
    },
    executionGeneration: manifest.executionGeneration,
    items,
    initialItems: manifest.items.map((item) => {
      const outcome = latestOutcomeByItemId.get(item.id);
      return openAttemptByItemId.has(item.id) || !outcome
        ? { id: item.id, status: "pending", error: null }
        : {
            id: item.id,
            status: outcome.outcome,
            error: outcome.error,
            result: toScrapeResultFromOutcome(item, outcome),
          };
    }),
    admitItem: async (item) => {
      const existing = openAttemptByItemId.get(item.id);
      if (existing) return existing;
      const attempt = input.admitAttempt(item.id);
      openAttemptByItemId.set(item.id, attempt.id);
      return attempt.id;
    },
    acquireItems: async (items) =>
      mediaPathOwnership.acquireAll(
        await prepareMediaPathKeys(
          items.map((item) => item.executionSource ?? item),
          input.resolveRoot,
        ),
        items
          .map((item) => item.id)
          .sort()
          .join(","),
      ),
    publicationKeys: (entries) =>
      entries.map(({ prepared }) => buildScrapePublicationKey(input.fileScrape(prepared).outputPlan)),
    checkTargets: async (entries) => {
      const files = entries.map(({ item, prepared }) => ({ item, file: input.fileScrape(prepared) }));
      await checkScrapeTargets(
        files.map(({ item, file }) => ({
          itemId: item.id,
          sourcePath: file.fileInfo.filePath,
          outputPlan: file.outputPlan,
        })),
        input.inventory,
      );
    },
    commitPreparationItem: async (_item, result, attemptId) => {
      if (result.status !== "failed" && result.status !== "skipped")
        throw new Error("Preparation can only commit failed or skipped results");
      const outcome = input.publication.scrapeRuns.commitOutcome({
        attemptId,
        outcome: result.status,
        error: result.status === "failed" ? result.error?.trim() || "刮削预检失败" : (result.error ?? null),
      });
      const committed = { ...result, resultId: outcome.id };
      input.onCommitted?.(committed);
      return committed;
    },
    commitItems: async (entries, publicationPlan) => {
      const committed = await commitScrapeTerminalResults({
        ...input.publication,
        publicationPlan,
        items: entries.flatMap(({ result, attemptId }) =>
          result
            ? [
                {
                  result,
                  attemptId,
                },
              ]
            : [],
        ),
        acquireAll: (keys) =>
          mediaPathOwnership.acquireAll(
            keys,
            entries
              .map(({ item }) => item.id)
              .sort()
              .join(","),
          ),
      });
      return committed.map((committedResult) => {
        const item = entries.find(({ item }) => item.id === committedResult.fileId)?.item;
        const result = item ? (input.transformResult?.(item, committedResult) ?? committedResult) : committedResult;
        input.onCommitted?.(result);
        return { itemId: result.fileId, result };
      });
    },
  };
}

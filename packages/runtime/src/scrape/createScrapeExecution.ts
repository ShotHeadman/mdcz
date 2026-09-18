import { basename, dirname } from "node:path";
import { filesystemPathKey, type MediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import type { Configuration } from "@mdcz/shared/config";
import { toErrorMessage } from "@mdcz/shared/error";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { ScrapeResult } from "@mdcz/shared/types";
import { mediaPathOwnership } from "../library/mediaPathOwnership";
import { PublicationConflictError } from "../publication/conflicts";
import { MoveOutput } from "../publication/MoveOutput";
import {
  libraryAssetsFromMovieOutput,
  movieOutputResultAssets,
  type PublicationLibraryAsset,
} from "../publication/outputLibrary";
import type { PreparedMovieOutput } from "../publication/prepareMovieOutput";
import type { PublicationFileSystem, PublicationJournalPort } from "../publication/types";
import { WriteOutput } from "../publication/WriteOutput";
import { resolveScrapeAttempts, resolveScrapeRetry } from "../tasks/session/resolveScrapeRetry";
import type { ScrapeRunExecution, ScrapeRunItem } from "../tasks/session/ScrapeRunSession";
import { toScrapeResultFromOutcome } from "../tasks/session/scrapeRunSnapshotDto";
import type { DirectoryInventory } from "./DirectoryInventory";
import { buildScrapePublicationKey } from "./FileOrganizer";
import type { PreparedFileScrape, ScrapeGroupResult } from "./FileScraper";
import { checkScrapeTargets } from "./preflightScrapeTask";
import { parseFileInfo } from "./utils/number";

interface ScrapeCommitStore {
  commitOutcome(input: { outcome: "failed" | "skipped"; attemptId: string; error?: string | null }): { id: string };
  commitSuccessOutcomes(
    inputs: readonly ScrapeSuccessCommit[],
    movie: {
      id: string;
      mediaIdentity: string;
      title: string;
      number: string;
      actors: string[];
      crawlerDataJson: string;
      createdAt: Date;
      assets: PublicationLibraryAsset[];
    },
  ): Array<{ attemptId: string; fileId: string; outcomeId: string; entryId: string }>;
}

interface ScrapeSuccessCommit {
  outcome: "success";
  error?: string | null;
  attemptId: string;
  crawlerDataJson: string;
  nfoRootId: string | null;
  nfoRelativePath: string | null;
  outputRootId: string;
  outputRelativePath: string;
  uncensoredAmbiguous: boolean;
  size: number;
  modifiedAt: Date | null;
  completedAt: Date;
  libraryEntry: {
    rootId: string;
    rootRelativePath: string;
    lastKnownPath: string;
    assets: PublicationLibraryAsset[];
    fileId: string;
    partNumber?: number | null;
    partSuffix?: string | null;
    resolution?: string | null;
    size: number;
    modifiedAt: Date | null;
  };
}

const formatCommitFailure = (error: unknown, committed = false): string =>
  committed
    ? `媒体库已提交，但清理失败：${toErrorMessage(error)}。请重新扫描`
    : `文件操作已回滚，媒体库提交失败：${toErrorMessage(error)}。请重新扫描`;

export const commitScrapeOutput = async (
  publication: { scrapeRuns: ScrapeCommitStore; journal: PublicationJournalPort; fileSystem?: PublicationFileSystem },
  entries: readonly { result?: ScrapeResult; attemptId: string }[],
  output?: PreparedMovieOutput,
): Promise<ScrapeResult[]> => {
  if (!entries.length && !output) throw new Error("Scrape terminal group must not be empty");
  const results: ScrapeResult[] = [];
  const terminal: Array<{ result: ScrapeResult; attemptId: string; cause?: unknown }> = entries.flatMap(
    ({ result, attemptId }) => (result ? [{ result, attemptId }] : []),
  );
  for (const item of terminal)
    if (item.result.status !== "failed" && item.result.status !== "skipped")
      throw new Error("Only failed/skipped outcomes may precede publication");

  if (output) {
    const group = output.scrape;
    if (!group || output.operationType !== "scrape" || !output.files.length)
      throw new Error("Scrape output requires prepared movie facts and files");
    const completedAt = new Date();
    const identity = group.crawlerData.number.trim() || output.files[0].scrape?.identity.fileName;
    if (!identity) throw new Error("Scrape movie has no media identity");
    const crawlerDataJson = JSON.stringify(group.crawlerData);
    const commits = output.files.map((video): ScrapeSuccessCommit => {
      const facts = video.scrape;
      if (!facts) throw new Error("Scrape file has no prepared facts");
      return {
        outcome: "success",
        error: facts.error ?? null,
        attemptId: facts.attemptId,
        crawlerDataJson,
        nfoRootId: group.nfo && group.nfo.rootId !== video.target.rootId ? group.nfo.rootId : null,
        nfoRelativePath: group.nfo?.relativePath ?? null,
        outputRootId: video.target.rootId,
        outputRelativePath: video.target.relativePath,
        uncensoredAmbiguous: facts.uncensoredAmbiguous,
        size: video.size,
        modifiedAt: video.modifiedAt,
        completedAt,
        libraryEntry: {
          fileId: video.fileId,
          rootId: video.target.rootId,
          rootRelativePath: video.target.relativePath,
          size: video.size,
          assets: libraryAssetsFromMovieOutput(output, video.assets),
          lastKnownPath: video.target.relativePath,
          partNumber: facts.fileInfo.part?.number ?? null,
          partSuffix: facts.fileInfo.part?.suffix ?? null,
          resolution: facts.fileInfo.resolution ?? null,
          modifiedAt: video.modifiedAt,
        },
      };
    });
    try {
      const commit = () => {
        const outcomes = publication.scrapeRuns.commitSuccessOutcomes(commits, {
          id: output.movieId,
          assets: libraryAssetsFromMovieOutput(output, output.movieAssets),
          mediaIdentity: identity,
          number: identity,
          title: group.crawlerData.title,
          actors: group.crawlerData.actors,
          crawlerDataJson,
          createdAt: completedAt,
        });
        const byAttempt = new Map(outcomes.map((outcome) => [outcome.attemptId, outcome]));
        if (
          outcomes.length !== commits.length ||
          byAttempt.size !== commits.length ||
          commits.some((item) => {
            const outcome = byAttempt.get(item.attemptId);
            return !outcome || outcome.fileId !== item.libraryEntry.fileId || outcome.entryId !== output.movieId;
          })
        )
          throw new Error("Scrape success batch does not match declared attempts and files");
        return outcomes;
      };
      const published = output.moves.length
        ? await new MoveOutput(publication.fileSystem).install({
            operationId: output.operationId,
            operationType: "scrape",
            moves: output.moves,
            artifacts: output.artifacts,
            journal: publication.journal,
            protectedSourceRoots: output.protectedSourceRoots,
            commit,
          })
        : await new WriteOutput(publication.fileSystem).install(output.artifacts, {
            protectedSourceRoots: output.protectedSourceRoots,
            commit,
          });
      const outcomes = new Map(published.value.map((outcome) => [outcome.attemptId, outcome]));
      const cleanupError = published.cleanupIssues.length
        ? formatCommitFailure(new AggregateError(published.cleanupIssues), true)
        : undefined;
      for (const video of output.files) {
        const facts = video.scrape;
        if (!facts) throw new Error("Scrape file has no prepared facts");
        const outcome = outcomes.get(facts.attemptId);
        if (!outcome) throw new Error(`Scrape success batch omitted declared file: ${facts.attemptId}`);
        results.push({
          ...facts.identity,
          fileId: facts.itemId,
          crawlerData: group.crawlerData,
          sources: group.sources,
          videoMeta: facts.videoMeta,
          nfo: group.nfo,
          error: cleanupError ?? facts.error,
          uncensoredAmbiguous: facts.uncensoredAmbiguous,
          resultId: outcome.outcomeId,
          status: "success",
          output: video.target,
          assets: movieOutputResultAssets(output, video),
        });
      }
    } catch (error) {
      if (error instanceof PublicationConflictError) throw error;
      const message = formatCommitFailure(error);
      for (const video of output.files) {
        const facts = video.scrape;
        if (!facts) throw new Error("Scrape file has no prepared facts");
        terminal.push({
          attemptId: facts.attemptId,
          cause: error,
          result: { ...facts.identity, fileId: facts.itemId, assets: [], status: "failed", error: message },
        });
      }
    }
  }
  const settled = await Promise.allSettled(
    terminal.map(async (item): Promise<ScrapeResult> => {
      const status = item.result.status;
      if (status !== "failed" && status !== "skipped") throw new Error("Cannot persist a non-terminal scrape outcome");
      const error = item.result.error?.trim() || (status === "failed" ? "刮削失败" : null);
      try {
        const outcome = publication.scrapeRuns.commitOutcome({ outcome: status, attemptId: item.attemptId, error });
        return { ...item.result, resultId: outcome.id, status, error: error ?? undefined };
      } catch (outcomeError) {
        if (item.cause) throw new AggregateError([item.cause, outcomeError], error ?? undefined);
        throw outcomeError;
      }
    }),
  );
  const failures = settled.flatMap((outcome) => (outcome.status === "rejected" ? [outcome.reason] : []));
  results.push(...settled.flatMap((outcome) => (outcome.status === "fulfilled" ? [outcome.value] : [])));
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "Multiple scrape terminal outcomes could not be committed");
  return results;
};

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
  publication: {
    scrapeRuns: ScrapeCommitStore;
    journal: import("../publication/types").PublicationJournalPort;
    fileSystem?: import("../publication/types").PublicationFileSystem;
  };
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
        await Promise.all(
          items.map(async (item) => {
            const ref = item.executionSource ?? item;
            return filesystemPathKey(resolveRootRelativePath(await input.resolveRoot(ref.rootId), ref.relativePath));
          }),
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
    commitItems: async (entries, output) => {
      const committed = await commitScrapeOutput(input.publication, entries, output);
      return committed.map((committedResult) => {
        const item = entries.find(({ item }) => item.id === committedResult.fileId)?.item;
        const result = item ? (input.transformResult?.(item, committedResult) ?? committedResult) : committedResult;
        input.onCommitted?.(result);
        return { itemId: result.fileId, result };
      });
    },
  };
}

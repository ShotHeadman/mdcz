import type { MediaRoot } from "@mdcz/media-store";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { ScrapeResult } from "@mdcz/shared/types";
import { mediaPathOwnership } from "../library/mediaPathOwnership";
import { commitScrapeTerminalResults } from "../publication/commitScrapeTerminalResult";
import { resolvePublicationSourceOwners } from "../publication/participants";
import { prepareMediaPathKeys, publicationRefKey } from "../publication/paths";
import { toRootFileRef } from "../publication/publicationPlan";
import { resolveScrapeAttempts, resolveScrapeRetry } from "../tasks/session/resolveScrapeRetry";
import type { ScrapeRunExecution, ScrapeRunItem } from "../tasks/session/ScrapeRunSession";
import { toScrapeResultFromOutcome } from "../tasks/session/scrapeRunSnapshotDto";
import { buildScrapePublicationKey } from "./FileOrganizer";
import type { PreparedFileScrape, ScrapeGroupResult } from "./FileScraper";
import { scrapeMovieGroupKey, validatePreparedScrapeFiles } from "./preflightScrapeTask";

export async function createScrapeExecution<TManual, TPrepared>(input: {
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
  execution: Pick<ScrapeRunExecution<TManual, TPrepared>, "concurrency" | "prepareItem"> & {
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
  return {
    concurrency: input.execution.concurrency,
    prepareItem: async (item, signal, attemptId) => {
      await input.restGate?.waitBeforeStart(signal);
      return await input.execution.prepareItem(item, signal, attemptId);
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
    formExecutionGroups: (entries) => {
      const groups = new Map<string, { itemIds: string[]; publicationKeys: string[] }>();
      for (const { item, prepared } of entries) {
        const file = input.fileScrape(prepared);
        const key = scrapeMovieGroupKey({
          libraryItemId: file.groupMovieId,
          sourcePath: file.fileInfo.filePath,
          mediaIdentity: file.crawlerData.number || file.fileInfo.number,
        });
        const group = groups.get(key) ?? { itemIds: [], publicationKeys: [] };
        group.itemIds.push(item.id);
        group.publicationKeys.push(buildScrapePublicationKey(file.outputPlan));
        groups.set(key, group);
      }
      return [...groups.values()];
    },
    validatePrepared: async (entries) => {
      const files = entries.map(({ item, prepared }) => ({ item, file: input.fileScrape(prepared) }));
      const sources = files.map(({ file }) => toRootFileRef(file.fileInfo.filePath, file.roots));
      const owners = input.publication.outputs
        ? await resolvePublicationSourceOwners({
            sources,
            snapshot: input.publication.outputs.publicationSnapshot({
              paths: files.map(({ file }) => file.fileInfo.filePath),
              includeOwners: true,
            }),
            resolveRoot: input.resolveRoot,
          })
        : new Map<string, string | null>();
      for (const [index, { file }] of files.entries())
        file.groupMovieId = owners.get(publicationRefKey(sources[index])) ?? undefined;
      await validatePreparedScrapeFiles(
        files.map(({ item, file }) => ({
          itemId: item.id,
          sourcePath: file.fileInfo.filePath,
          libraryItemId: file.groupMovieId,
          outputPlan: file.outputPlan,
          mediaIdentity: file.crawlerData.number || file.fileInfo.number,
          partNumber: file.fileInfo.part?.number ?? null,
        })),
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

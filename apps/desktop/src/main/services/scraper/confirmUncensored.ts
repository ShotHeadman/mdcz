import { stat } from "node:fs/promises";
import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import type { DesktopPersistenceState } from "@main/services/persistence";
import { fileOrganizer } from "@main/services/scraper/FileScraper";
import { pathExists } from "@main/utils/file";
import { type MediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import type { ScrapeRunManifest } from "@mdcz/persistence";
import { LocalScanService } from "@mdcz/runtime/maintenance";
import { commitPublishedMedia, createPublicationPlan, registeredMediaLocations } from "@mdcz/runtime/publication";
import { buildUncensoredRevision, confirmUncensoredOutputs, nfoGenerator } from "@mdcz/runtime/scrape";
import { crawlerDataSchema } from "@mdcz/shared/serverDtos";
import type { UncensoredChoice, UncensoredConfirmResponse } from "@mdcz/shared/types";

const logger = loggerService.getLogger("ConfirmUncensored");

/**
 * Resolves the requested run items to their latest successful outputs, then
 * publishes the files and revises outcome plus library rows inside the
 * publication journal transaction, so disk and database cannot diverge.
 */
export const confirmUncensoredRunItems = async (input: {
  manifest: ScrapeRunManifest;
  items: readonly { itemId: string; choice: UncensoredChoice }[];
  configuration: Configuration;
  state: DesktopPersistenceState;
}): Promise<UncensoredConfirmResponse> => {
  const { manifest, configuration, state } = input;
  if (!state.repositories.scrapeRuns.summary(manifest)) {
    throw new Error("无码确认只允许修改已结束刮削的成功结果");
  }
  const outcomeByItem = new Map(
    state.repositories.scrapeRuns.latestOutcomes(manifest).map((outcome) => [outcome.itemId, outcome]),
  );
  const itemById = new Map(manifest.items.map((item) => [item.id, item]));
  const selected = input.items.map((selection) => {
    const item = itemById.get(selection.itemId);
    if (!item) throw new Error(`Item does not belong to scrape task: ${selection.itemId}`);
    const outcome = outcomeByItem.get(item.id);
    if (!outcome || outcome.outcome !== "success" || !outcome.outputRootId || !outcome.outputRelativePath) {
      throw new Error(`Item does not belong to successful scrape output: ${selection.itemId}`);
    }
    return { selection, item, outcome };
  });

  const roots = new Map<string, MediaRoot>((await state.repositories.mediaRoots.list()).map((root) => [root.id, root]));
  const resolved = selected.map(({ selection, item, outcome }) => {
    const { outputRootId, outputRelativePath } = outcome;
    if (!outputRootId || !outputRelativePath) {
      throw new Error(`Successful scrape outcome is missing output facts: ${outcome.id}`);
    }
    const outputRoot = roots.get(outputRootId);
    const nfoRoot = roots.get(outcome.nfoRootId ?? outputRootId);
    if (!outputRoot || !nfoRoot) {
      throw new Error(`Scrape output root disappeared before uncensored confirmation: ${outcome.id}`);
    }
    return { selection, item, outcome, outputRootId, outputRelativePath, outputRoot, nfoRoot };
  });

  const locations = await registeredMediaLocations(
    state.repositories.library,
    (id) => state.repositories.mediaRoots.get(id),
    resolved.map(({ outputRoot, outputRelativePath }) => resolveRootRelativePath(outputRoot, outputRelativePath)),
  );
  const confirmation = await confirmUncensoredOutputs(
    resolved.map(({ selection, item, outcome, outputRelativePath, outputRoot, nfoRoot }) => ({
      fileId: item.id,
      videoPath: resolveRootRelativePath(outputRoot, outputRelativePath),
      nfoPath: outcome.nfoRelativePath ? resolveRootRelativePath(nfoRoot, outcome.nfoRelativePath) : undefined,
      crawlerData: outcome.crawlerDataJson ? crawlerDataSchema.parse(JSON.parse(outcome.crawlerDataJson)) : undefined,
      groupId: locations.get(resolveRootRelativePath(outputRoot, outputRelativePath))?.groupId,
      registeredAssets: locations.get(resolveRootRelativePath(outputRoot, outputRelativePath))?.assets,
      metadataVideoPath: locations.get(resolveRootRelativePath(outputRoot, outputRelativePath))?.strmPath,
      choice: selection.choice,
    })),
    configuration,
    {
      fileOrganizer,
      localScanService: new LocalScanService(),
      logger,
      nfoGenerator,
      pathExists,
      publish: async ({ operationId, plan, updates }) => {
        const revisions = await Promise.all(
          updates.map(async (update) => {
            const target = resolved.find(({ item }) => item.id === update.fileId);
            if (!target) throw new Error(`Uncensored confirmation item disappeared: ${update.fileId}`);
            const { outcome, outputRootId, outputRelativePath } = target;
            const [entry, fileStats] = await Promise.all([
              state.repositories.library.getEntry(outputRootId, outputRelativePath),
              stat(update.sourceVideoPath),
            ]);
            return buildUncensoredRevision({
              roots: [...roots.values()],
              update,
              outcome,
              entry,
              size: fileStats.size,
              modifiedAt: fileStats.mtime,
            });
          }),
        );
        await commitPublishedMedia(createPublicationPlan(operationId, "maintenance", plan, [...roots.values()]), {
          journal: state.repositories.publicationJournal,
          outputs: state.repositories.library,
          repairIssues: state.repositories.libraryRepairIssues,
          resolveRoot: async (rootId) => {
            const root = roots.get(rootId);
            if (!root) throw new Error(`Publication root not found: ${rootId}`);
            return root;
          },
          commit: () => state.repositories.scrapeRuns.reviseSuccess(revisions),
        });
      },
    },
  );
  // Failures stay in the response: the workbench reports per-group success and
  // failure counts, and every reason is already logged by the runtime.
  return {
    updatedCount: confirmation.updatedCount,
    items: confirmation.items.map(
      ({ assets: _assets, outputAssets: _outputAssets, removedAssetPaths: _removedAssetPaths, ...item }) => item,
    ),
  };
};

import path from "node:path";
import { type MediaRoot, toRootRelativePath } from "@mdcz/media-store";
import type { ScrapeItemOutcomeRecord, ScrapeRunItemRecord } from "@mdcz/persistence";
import { crawlerDataSchema, type ScrapeResultDto } from "@mdcz/shared/serverDtos";

export const toScrapeResultDto = (
  outcome: ScrapeItemOutcomeRecord,
  item: ScrapeRunItemRecord,
  options: { rootDisplayName: string; runCreatedAt: Date },
): ScrapeResultDto => ({
  id: outcome.id,
  taskId: outcome.runId,
  rootId: item.rootId,
  rootDisplayName: options.rootDisplayName,
  outputRootId: outcome.outputRootId,
  relativePath: item.relativePath,
  fileName: path.posix.basename(item.relativePath),
  status: outcome.outcome,
  error: outcome.error,
  crawlerData: outcome.crawlerDataJson ? crawlerDataSchema.parse(JSON.parse(outcome.crawlerDataJson)) : null,
  nfoRootId: outcome.nfoRootId,
  nfoRelativePath: outcome.nfoRelativePath,
  outputRelativePath: outcome.outputRelativePath,
  manualUrl: item.manualUrl,
  uncensoredAmbiguous: outcome.uncensoredAmbiguous,
  persistenceState: "terminal",
  createdAt: options.runCreatedAt.toISOString(),
  updatedAt: outcome.completedAt.toISOString(),
});

export const toRootRelativeAssetPath = (root: MediaRoot, assetPath: string | undefined): string | null => {
  if (!assetPath) {
    return null;
  }
  try {
    return toRootRelativePath(root, assetPath);
  } catch {
    return null;
  }
};

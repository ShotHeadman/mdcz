import path from "node:path";
import type { LibraryItemAssetRecord, ScrapeItemOutcomeRecord, ScrapeRunItemRecord } from "@mdcz/persistence";
import type { AssetRef } from "@mdcz/shared/mediaRef";
import { crawlerDataSchema, type ScrapeResultDto } from "@mdcz/shared/serverDtos";

export const toScrapeResultDto = (
  outcome: ScrapeItemOutcomeRecord,
  item: ScrapeRunItemRecord,
  options: {
    runId: string;
    rootDisplayName: string;
    runCreatedAt: Date;
    assets: Pick<LibraryItemAssetRecord, "kind" | "uri" | "rootId" | "relativePath">[];
  },
): ScrapeResultDto => ({
  id: outcome.id,
  taskId: options.runId,
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
  assets: options.assets.map(
    (asset): AssetRef =>
      asset.rootId && asset.relativePath
        ? { type: "local", kind: asset.kind, file: { rootId: asset.rootId, relativePath: asset.relativePath } }
        : { type: "remote", kind: asset.kind, url: asset.uri },
  ),
  manualUrl: item.manualUrl,
  uncensoredAmbiguous: outcome.uncensoredAmbiguous,
  persistenceState: "terminal",
  createdAt: options.runCreatedAt.toISOString(),
  updatedAt: outcome.completedAt.toISOString(),
});

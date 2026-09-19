import path from "node:path";
import type { LibraryItemAssetRecord, ScrapeRunItemRecord } from "@mdcz/persistence";
import type { AssetRef } from "@mdcz/shared/mediaRef";
import { crawlerDataSchema, type ScrapeResultDto } from "@mdcz/shared/serverDtos";

export const toScrapeResultDto = (
  item: ScrapeRunItemRecord,
  options: {
    runId: string;
    rootDisplayName: string;
    runCreatedAt: Date;
    crawlerDataJson?: string | null;
    outputRootId?: string | null;
    outputRelativePath?: string | null;
    nfoRootId?: string | null;
    nfoRelativePath?: string | null;
    assets: Pick<LibraryItemAssetRecord, "kind" | "uri" | "rootId" | "relativePath">[];
  },
): ScrapeResultDto => ({
  id: item.id,
  taskId: options.runId,
  rootId: item.rootId,
  rootDisplayName: options.rootDisplayName,
  outputRootId: options.outputRootId ?? null,
  relativePath: item.relativePath,
  fileName: path.posix.basename(item.relativePath),
  status: item.status ?? "failed",
  error: item.errorMessage,
  crawlerData: options.crawlerDataJson ? crawlerDataSchema.parse(JSON.parse(options.crawlerDataJson)) : null,
  nfoRootId: options.nfoRootId ?? null,
  nfoRelativePath: options.nfoRelativePath ?? null,
  outputRelativePath: options.outputRelativePath ?? null,
  assets: options.assets.map(
    (asset): AssetRef =>
      asset.rootId && asset.relativePath
        ? { type: "local", kind: asset.kind, file: { rootId: asset.rootId, relativePath: asset.relativePath } }
        : { type: "remote", kind: asset.kind, url: asset.uri },
  ),
  manualUrl: item.manualUrl,
  uncensoredAmbiguous: item.uncensoredAmbiguous,
  createdAt: (item.completedAt ?? options.runCreatedAt).toISOString(),
  updatedAt: (item.completedAt ?? options.runCreatedAt).toISOString(),
});

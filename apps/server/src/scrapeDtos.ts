import path from "node:path";
import { type MediaRoot, toRootRelativePath } from "@mdcz/media-store";
import type { LibraryItemAssetRecord, ScrapeItemOutcomeRecord, ScrapeRunItemRecord } from "@mdcz/persistence";
import { crawlerDataSchema, type ScrapeResultDto } from "@mdcz/shared/serverDtos";

export const toScrapeResultDto = (
  outcome: ScrapeItemOutcomeRecord,
  item: ScrapeRunItemRecord,
  options: {
    runId: string;
    rootDisplayName: string;
    runCreatedAt: Date;
    assets: Pick<LibraryItemAssetRecord, "kind" | "rootId" | "relativePath">[];
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
  ...toScrapeAssetDto(options.assets),
  manualUrl: item.manualUrl,
  uncensoredAmbiguous: outcome.uncensoredAmbiguous,
  persistenceState: "terminal",
  createdAt: options.runCreatedAt.toISOString(),
  updatedAt: outcome.completedAt.toISOString(),
});

export const toScrapeAssetDto = (
  assets: Pick<LibraryItemAssetRecord, "kind" | "rootId" | "relativePath">[],
): Pick<ScrapeResultDto, "assetRootId" | "sceneImageRelativePaths" | "trailerRelativePath"> => {
  const localAssets = assets.filter(
    (asset) => (asset.kind === "scene" || asset.kind === "trailer") && asset.rootId && asset.relativePath,
  );
  const assetRootId = localAssets[0]?.rootId ?? null;
  return {
    assetRootId,
    sceneImageRelativePaths: localAssets
      .filter((asset) => asset.kind === "scene")
      .map((asset) => asset.relativePath as string),
    trailerRelativePath: localAssets.find((asset) => asset.kind === "trailer")?.relativePath ?? null,
  };
};

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

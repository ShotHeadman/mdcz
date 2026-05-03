import path from "node:path";
import type { ScrapeResultRecord } from "@mdcz/persistence";
import type { CrawlerDataDto, ScrapeResultDto } from "@mdcz/shared/serverDtos";
import { type MediaRoot, toRootRelativePath } from "@mdcz/storage";

export const toScrapeResultDto = (
  record: ScrapeResultRecord,
  options: { rootDisplayName: string },
): ScrapeResultDto => ({
  id: record.id,
  taskId: record.taskId,
  rootId: record.rootId,
  rootDisplayName: options.rootDisplayName,
  relativePath: record.relativePath,
  fileName: path.posix.basename(record.relativePath),
  status: record.status,
  error: record.error,
  crawlerData: record.crawlerDataJson ? (JSON.parse(record.crawlerDataJson) as CrawlerDataDto) : null,
  nfoRelativePath: record.nfoRelativePath,
  outputRelativePath: record.outputRelativePath,
  manualUrl: record.manualUrl,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
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

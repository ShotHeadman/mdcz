import { Website } from "./enums";
import type { MaintenancePreviewItemDto, ScrapeResultDto } from "./serverDtos";
import type { CrawlerData, FieldDiff, MaintenancePreviewItem, ScrapeResult } from "./types";

const emptyCrawlerData = (relativePath = ""): CrawlerData => ({
  actors: [],
  genres: [],
  number: "",
  scene_images: [],
  title:
    relativePath
      .split("/")
      .pop()
      ?.replace(/\.[^.]+$/u, "") ?? "",
  title_zh: "",
  website: Website.JAVDB,
});

export const scrapeResultDtoToScrapeResult = (result: ScrapeResultDto): ScrapeResult => ({
  fileId: `${result.rootId}:${result.relativePath}`,
  fileInfo: {
    filePath: result.relativePath,
    fileName: result.fileName,
    extension: result.fileName.split(".").pop() ?? "",
    number: result.crawlerData?.number ?? result.fileName.replace(/\.[^.]+$/u, ""),
    isSubtitled: false,
  },
  status: result.status,
  crawlerData: result.crawlerData ?? undefined,
  error: result.error ?? undefined,
  outputPath: result.outputRelativePath ?? undefined,
  nfoPath: result.nfoRelativePath ?? undefined,
  uncensoredAmbiguous: result.uncensoredAmbiguous,
  assets: undefined,
});

export const scrapeResultDtoToDetailScrapeResult = (result: ScrapeResultDto): ScrapeResult => ({
  ...scrapeResultDtoToScrapeResult(result),
  crawlerData: result.crawlerData ?? emptyCrawlerData(result.relativePath),
});

const toMaintenanceFieldDiffs = (diffs: unknown): FieldDiff[] => (Array.isArray(diffs) ? (diffs as FieldDiff[]) : []);

export const maintenancePreviewDtoToPreviewItem = (item: MaintenancePreviewItemDto): MaintenancePreviewItem => ({
  fileId: `${item.rootId}:${item.relativePath}`,
  previewId: item.id,
  taskId: item.taskId,
  status: item.status === "ready" || item.status === "applied" ? "ready" : "blocked",
  error: item.error ?? undefined,
  fieldDiffs: toMaintenanceFieldDiffs(item.fieldDiffs),
  unchangedFieldDiffs: toMaintenanceFieldDiffs(item.unchangedFieldDiffs),
  pathDiff: item.pathDiff ?? undefined,
  proposedCrawlerData: item.proposedCrawlerData ?? undefined,
});

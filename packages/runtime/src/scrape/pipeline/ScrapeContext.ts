import { randomUUID } from "node:crypto";
import type { Configuration } from "@mdcz/shared/config";
import { buildFileId } from "@mdcz/shared/mediaIdentity";
import type {
  CrawlerData,
  DownloadedAssets,
  FileId,
  FileInfo,
  NfoLocalState,
  ScrapeResult,
  VideoMeta,
} from "@mdcz/shared/types";
import type { AggregationResult, ManualScrapeOptions } from "../aggregation";
import type { OrganizePlan } from "../FileOrganizer";
import type { ScrapeExecutionMode } from "../FileScraper";
import { type FileInfoWithSubtitles, resolveFileInfoWithSubtitles, type SubtitleSidecarMatch } from "../media";
import { parseFileInfo } from "../utils/number";

export class ScrapeContext {
  readonly taskId = randomUUID();

  readonly parsedFileInfo: FileInfo;

  readonly fileId: FileId;

  readonly fileInfoWithSubtitlesPromise: Promise<FileInfoWithSubtitles>;

  fileInfo: FileInfo;

  subtitleSidecars: SubtitleSidecarMatch[] = [];

  configuration?: Configuration;

  existingNfoLocalState?: NfoLocalState;

  aggregationResult?: AggregationResult | null;

  translatedCrawlerData?: CrawlerData;

  preparedCrawlerData?: CrawlerData;

  actorPhotoPaths: string[] = [];

  videoMeta?: VideoMeta;

  plan?: OrganizePlan;

  assets?: DownloadedAssets;

  savedNfoPath?: string;

  outputVideoPath?: string;

  result?: ScrapeResult;

  constructor(
    readonly filePath: string,
    readonly progress: { fileIndex: number; totalFiles: number } = { fileIndex: 1, totalFiles: 1 },
    readonly mode: ScrapeExecutionMode = "batch",
    readonly manualScrape?: ManualScrapeOptions,
  ) {
    this.parsedFileInfo = parseFileInfo(filePath);
    this.fileId = buildFileId(this.parsedFileInfo.filePath);
    this.fileInfo = this.parsedFileInfo;
    this.fileInfoWithSubtitlesPromise = resolveFileInfoWithSubtitles(filePath, {
      parsedFileInfo: this.parsedFileInfo,
    });
  }

  async resolveFileInfo(): Promise<FileInfo> {
    const { fileInfo, subtitleSidecars } = await this.fileInfoWithSubtitlesPromise;
    this.fileInfo = fileInfo;
    this.subtitleSidecars = subtitleSidecars;
    return fileInfo;
  }

  getCrawlerData(): CrawlerData | undefined {
    return this.preparedCrawlerData ?? this.translatedCrawlerData ?? this.aggregationResult?.data;
  }

  requireConfiguration(): Configuration {
    if (!this.configuration) {
      throw new Error("Scrape configuration not initialized");
    }

    return this.configuration;
  }

  requireAggregationResult(): AggregationResult {
    if (!this.aggregationResult) {
      throw new Error("Scrape aggregation result not initialized");
    }

    return this.aggregationResult;
  }

  requireCrawlerData(): CrawlerData {
    const crawlerData = this.getCrawlerData();
    if (!crawlerData) {
      throw new Error("Scrape crawler data not initialized");
    }

    return crawlerData;
  }

  requirePlan(): OrganizePlan {
    if (!this.plan) {
      throw new Error("Scrape output plan not initialized");
    }

    return this.plan;
  }
}

import type { Configuration } from "@mdcz/shared/config";
import type { CrawlerData, DownloadedAssets, FileInfo, NfoLocalState, ScrapeResult } from "@mdcz/shared/types";
import type { RuntimeActorImageService } from "../actorOutput";
import type { AggregationResult, ManualScrapeOptions } from "../aggregation";
import type { FileOrganizer } from "../FileOrganizer";
import type { NfoGenerator } from "../nfo";
import type { ScrapeContext } from "./ScrapeContext";

export interface ScrapeStage {
  execute(context: ScrapeContext, signal?: AbortSignal): Promise<void>;
}

export interface RuntimeScrapeSignalService {
  showFailedInfo(input: { fileInfo: FileInfo; error: string }): void;
  showLogText(message: string): void;
  showScrapeInfo(input: {
    fileInfo: FileInfo;
    site: CrawlerData["website"];
    step: "search" | "download" | "parse" | "organize";
  }): void;
  showScrapeResult(result: ScrapeResult): void;
  setProgress(value: number, current: number, total: number): void;
}

export interface FileScraperStageRuntime {
  actorImageService?: RuntimeActorImageService;
  actorSourceProvider?: unknown;
  fileOrganizer: FileOrganizer;
  logger: { warn(message: string): void };
  nfoGenerator: NfoGenerator;
  signalService: RuntimeScrapeSignalService;
  getConfiguration(): Promise<Configuration>;
  aggregateMetadata(
    fileInfo: FileInfo,
    configuration: Configuration,
    signal?: AbortSignal,
    manualScrape?: ManualScrapeOptions,
  ): Promise<AggregationResult | null>;
  handleFailedFileMove(fileInfo: FileInfo, configuration: Configuration): Promise<FileInfo>;
  loadExistingNfoLocalState(filePath: string, configuration: Configuration): Promise<NfoLocalState | undefined>;
  setProgress(progress: { fileIndex: number; totalFiles: number }, stepPercent: number): void;
  translateCrawlerData(
    crawlerData: CrawlerData,
    configuration: Configuration,
    signal?: AbortSignal,
  ): Promise<CrawlerData>;
  probeVideoMetadata(context: ScrapeContext): Promise<ScrapeContext["videoMeta"]>;
  prepareOutputCrawlerData(
    context: ScrapeContext,
    signal?: AbortSignal,
  ): Promise<{ data: CrawlerData; actorPhotoPaths: string[] }>;
  downloadCrawlerAssets(
    context: ScrapeContext,
    signal?: AbortSignal,
  ): Promise<{ assets: DownloadedAssets; crawlerData?: CrawlerData }>;
  writePreparedNfo(context: ScrapeContext, signal?: AbortSignal): Promise<string | undefined>;
  organizePreparedVideo(context: ScrapeContext, signal?: AbortSignal): Promise<string>;
}

import type { ActorImageService } from "@main/services/ActorImageService";
import type { ActorSourceProvider } from "@main/services/actorSource";
import type { Configuration } from "@main/services/config";
import type { SignalService } from "@main/services/SignalService";
import type { CrawlerData, FileInfo, NfoLocalState } from "@shared/types";
import type { Logger } from "winston";
import type { AggregationResult } from "../aggregation";
import type { DownloadManager } from "../DownloadManager";
import type { FileOrganizer } from "../FileOrganizer";
import type { ManualScrapeOptions } from "../manualScrape";
import type { NfoGenerator } from "../NfoGenerator";
import type { ScrapeContext } from "./ScrapeContext";

export interface ScrapeStage {
  execute(context: ScrapeContext, signal?: AbortSignal): Promise<void>;
}

export interface FileScraperStageRuntime {
  actorImageService: ActorImageService;
  actorSourceProvider?: ActorSourceProvider;
  downloadManager: DownloadManager;
  fileOrganizer: FileOrganizer;
  logger: Pick<Logger, "warn">;
  nfoGenerator: NfoGenerator;
  signalService: Pick<
    SignalService,
    "showFailedInfo" | "showLogText" | "showScrapeInfo" | "showScrapeResult" | "setProgress"
  >;
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
}

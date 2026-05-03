import type { ActorImageService } from "@main/services/ActorImageService";
import type { ActorSourceProvider } from "@main/services/actorSource";
import type { SignalService } from "@main/services/SignalService";
import type { TranslateService } from "@mdcz/runtime/scrape";
import {
  type FileScrapeOptions,
  type FileScrapeProgress,
  FileScraper,
  type ScrapeExecutionMode,
} from "@mdcz/runtime/scrape";
import type { AggregationService } from "./aggregation";
import type { DownloadManager } from "./DownloadManager";
import type { LocalScanService } from "./maintenance/LocalScanService";
import type { NfoGenerator } from "./NfoGenerator";
import { DefaultFileScraperPipeline } from "./pipeline";

export { type FileScrapeOptions, type FileScrapeProgress, FileScraper, type ScrapeExecutionMode };

export interface FileScraperDependencies {
  aggregationService: AggregationService;
  translateService: TranslateService;
  nfoGenerator: NfoGenerator;
  downloadManager: DownloadManager;
  fileOrganizer: import("@mdcz/runtime/scrape").FileOrganizer;
  signalService: SignalService;
  actorImageService?: ActorImageService;
  actorSourceProvider?: ActorSourceProvider;
  localScanService?: Pick<LocalScanService, "scanVideo">;
}

export interface CreateFileScraperOptions {
  mode?: ScrapeExecutionMode;
}

export const createFileScraper = (deps: FileScraperDependencies, options: CreateFileScraperOptions = {}): FileScraper =>
  new FileScraper(new DefaultFileScraperPipeline(deps, options.mode));

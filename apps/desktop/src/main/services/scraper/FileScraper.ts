import type { ActorImageService } from "@main/services/ActorImageService";
import type { SignalService } from "@main/services/SignalService";
import type { ActorSourceProvider } from "@mdcz/runtime/actorSource";
import type { LocalScanService } from "@mdcz/runtime/maintenance";
import type { AggregationService, TranslateService } from "@mdcz/runtime/scrape";
import {
  type FileScrapeOptions,
  type FileScrapeProgress,
  FileScraper,
  type ScrapeExecutionMode,
} from "@mdcz/runtime/scrape";
import type { DownloadManager } from "./DownloadManager";
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

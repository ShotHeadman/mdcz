import type { ActorImageService } from "@main/services/ActorImageService";
import type { ActorSourceProvider } from "@main/services/actorSource";
import type { SignalService } from "@main/services/SignalService";
import type { ScrapeResult } from "@mdcz/shared/types";
import { isAbortError } from "./abort";
import type { AggregationService } from "./aggregation";
import type { DownloadManager } from "./DownloadManager";
import type { FileOrganizer } from "./FileOrganizer";
import type { LocalScanService } from "./maintenance/LocalScanService";
import type { ManualScrapeOptions } from "./manualScrape";
import type { NfoGenerator } from "./NfoGenerator";
import { DefaultFileScraperPipeline, type FileScraperPipeline } from "./pipeline";
import type { TranslateService } from "./TranslateService";

export interface FileScraperDependencies {
  aggregationService: AggregationService;
  translateService: TranslateService;
  nfoGenerator: NfoGenerator;
  downloadManager: DownloadManager;
  fileOrganizer: FileOrganizer;
  signalService: SignalService;
  actorImageService?: ActorImageService;
  actorSourceProvider?: ActorSourceProvider;
  localScanService?: Pick<LocalScanService, "scanVideo">;
}

export type ScrapeExecutionMode = "single" | "batch";

export interface FileScrapeProgress {
  fileIndex: number;
  totalFiles: number;
}

export interface FileScrapeOptions {
  manualScrape?: ManualScrapeOptions;
}

export interface CreateFileScraperOptions {
  mode?: ScrapeExecutionMode;
}

export class FileScraper {
  constructor(private readonly pipeline: FileScraperPipeline) {}

  async scrapeFile(
    filePath: string,
    progress: FileScrapeProgress = { fileIndex: 1, totalFiles: 1 },
    signal?: AbortSignal,
    options: FileScrapeOptions = {},
  ): Promise<ScrapeResult> {
    const context = this.pipeline.createContext(filePath, progress, options);
    this.pipeline.setProgress(progress, 0);

    try {
      return await this.pipeline.runExclusiveByNumber(context.fileInfo.number, async () => {
        for (const stage of this.pipeline.stages) {
          await stage.execute(context, signal);
          if (context.result) {
            return context.result;
          }
        }

        throw new Error(`Scrape pipeline completed without a result for ${context.fileInfo.filePath}`);
      });
    } catch (error) {
      if (isAbortError(error)) {
        return await this.pipeline.handleAbort(context);
      }

      return await this.pipeline.handleError(context, error);
    }
  }
}

export const createFileScraper = (deps: FileScraperDependencies, options: CreateFileScraperOptions = {}): FileScraper =>
  new FileScraper(new DefaultFileScraperPipeline(deps, options.mode));

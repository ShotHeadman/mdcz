import type { ActorImageService } from "@main/services/ActorImageService";
import type { ActorSourceProvider } from "@main/services/actorSource";
import type { ConfigManager } from "@main/services/config/ConfigManager";
import type { SignalService } from "@main/services/SignalService";
import type { ScrapeResult } from "@shared/types";
import { isAbortError } from "./abort";
import type { AggregationService } from "./aggregation";
import type { DownloadManager } from "./DownloadManager";
import type { FileOrganizer } from "./FileOrganizer";
import type { LocalScanService } from "./maintenance/LocalScanService";
import type { NfoGenerator } from "./NfoGenerator";
import { DefaultFileScraperPipeline, type FileScraperPipeline } from "./pipeline";
import type { TranslateService } from "./TranslateService";

export interface FileScraperDependencies {
  configManager: ConfigManager;
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

export interface FileScrapeProgress {
  fileIndex: number;
  totalFiles: number;
}

export class FileScraper {
  constructor(private readonly pipeline: FileScraperPipeline) {}

  async scrapeFile(
    filePath: string,
    progress: FileScrapeProgress = { fileIndex: 1, totalFiles: 1 },
    signal?: AbortSignal,
  ): Promise<ScrapeResult> {
    const context = this.pipeline.createContext(filePath, progress);
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

export const createFileScraper = (deps: FileScraperDependencies): FileScraper =>
  new FileScraper(new DefaultFileScraperPipeline(deps));

import type { ScrapeResult } from "@mdcz/shared/types";
import type { RuntimeActorImageService } from "./actorOutput";
import type { AggregationService, ManualScrapeOptions } from "./aggregation";
import type { FileOrganizer } from "./FileOrganizer";
import type { NfoGenerator } from "./nfo";
import type { FileScraperPipeline } from "./pipeline";
import { isAbortError } from "./utils/abort";

export interface FileScraperDependencies {
  aggregationService: AggregationService;
  nfoGenerator: NfoGenerator;
  fileOrganizer: FileOrganizer;
  actorImageService?: RuntimeActorImageService;
  actorSourceProvider?: unknown;
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

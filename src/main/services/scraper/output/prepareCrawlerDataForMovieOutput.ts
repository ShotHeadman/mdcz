import type { ActorImageService } from "@main/services/ActorImageService";
import type { ActorSourceProvider } from "@main/services/actorSource";
import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import type { CrawlerData } from "@shared/types";
import { isAbortError, throwIfAborted } from "../abort";
import { prepareCrawlerDataForNfo } from "./prepareCrawlerDataForNfo";

const logger = loggerService.getLogger("PrepareCrawlerDataForMovieOutput");

export interface PreparedCrawlerDataForMovieOutput {
  data: CrawlerData;
  actorPhotoPaths: string[];
}

export const prepareCrawlerDataForMovieOutput = async (
  actorImageService: ActorImageService,
  configuration: Configuration,
  crawlerData: CrawlerData,
  options: {
    enabled?: boolean;
    movieDir?: string;
    sourceVideoPath: string;
    actorSourceProvider?: ActorSourceProvider;
    signal?: AbortSignal;
  },
): Promise<PreparedCrawlerDataForMovieOutput> => {
  if (!options.enabled || !options.movieDir) {
    return {
      data: crawlerData,
      actorPhotoPaths: [],
    };
  }

  throwIfAborted(options.signal);

  try {
    return await prepareCrawlerDataForNfo(actorImageService, configuration, crawlerData, {
      movieDir: options.movieDir,
      sourceVideoPath: options.sourceVideoPath,
      actorSourceProvider: options.actorSourceProvider,
      signal: options.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to prepare movie output data for ${crawlerData.number || options.sourceVideoPath}: ${message}`);
    return {
      data: crawlerData,
      actorPhotoPaths: [],
    };
  }
};

import type { Configuration } from "@mdcz/shared/config";
import { toErrorMessage } from "@mdcz/shared/error";
import type { CrawlerData } from "@mdcz/shared/types";
import type { RuntimeLogger } from "../../shared";
import { noopRuntimeLogger } from "../../shared";
import type { RuntimeActorImageService, RuntimeActorSourceHint } from "../actorOutput";
import { isAbortError, throwIfAborted } from "../utils/abort";
import { prepareCrawlerDataForNfo } from "./prepareCrawlerDataForNfo";

export interface PreparedCrawlerDataForMovieOutput {
  data: CrawlerData;
  actorPhotoPaths: string[];
}

export const prepareCrawlerDataForMovieOutput = async (
  actorImageService: RuntimeActorImageService,
  configuration: Configuration,
  crawlerData: CrawlerData,
  options: {
    enabled?: boolean;
    movieDir?: string;
    sourceVideoPath: string;
    actorSourceProvider?: unknown;
    sourceHints?: RuntimeActorSourceHint[];
    logger?: Pick<RuntimeLogger, "warn">;
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
      sourceHints: options.sourceHints,
      signal: options.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    const message = toErrorMessage(error);
    const logger = options.logger ?? noopRuntimeLogger;
    logger.warn(`Failed to prepare movie output data for ${crawlerData.number || options.sourceVideoPath}: ${message}`);
    return {
      data: crawlerData,
      actorPhotoPaths: [],
    };
  }
};

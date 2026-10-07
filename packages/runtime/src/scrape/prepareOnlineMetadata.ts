import type { Configuration } from "@mdcz/shared/config";
import type { CrawlerData, NfoLocalState } from "@mdcz/shared/types";
import type { AggregationService, ManualScrapeOptions } from "./aggregation";
import { publishMetadata } from "./publishMetadata";
import type { TranslateService } from "./TranslateService";
import { throwIfAborted } from "./utils/abort";

export const prepareOnlineMetadata = async (input: {
  number: string;
  configuration: Configuration;
  aggregationService: Pick<AggregationService, "aggregate">;
  translateService: Pick<TranslateService, "translateCrawlerData">;
  published?: { crawlerData?: CrawlerData; localState?: NfoLocalState };
  keepEdits: boolean;
  manualScrape?: ManualScrapeOptions;
  signal?: AbortSignal;
}) => {
  const aggregation = await input.aggregationService.aggregate(input.number, {
    manualScrape: input.manualScrape,
    signal: input.signal,
  });
  throwIfAborted(input.signal);
  const publication = await publishMetadata({
    data: aggregation.data,
    published: input.published,
    keepEdits: input.keepEdits,
    configuration: input.configuration,
    translateService: input.translateService,
    signal: input.signal,
  });
  throwIfAborted(input.signal);
  return { aggregation, crawlerData: publication.data, translationError: publication.error };
};

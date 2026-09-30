import type { Configuration } from "@mdcz/shared/config";
import type { AggregationService, ManualScrapeOptions } from "./aggregation";
import { canonicalizeCrawlerDataActorAliases } from "./canonicalizeActorAliases";
import type { TranslateService } from "./TranslateService";
import { throwIfAborted } from "./utils/abort";

export const prepareOnlineMetadata = async (input: {
  number: string;
  configuration: Configuration;
  aggregationService: Pick<AggregationService, "aggregate">;
  translateService: Pick<TranslateService, "translateCrawlerData">;
  manualScrape?: ManualScrapeOptions;
  signal?: AbortSignal;
}) => {
  const aggregation = await input.aggregationService.aggregate(input.number, {
    manualScrape: input.manualScrape,
    signal: input.signal,
  });
  throwIfAborted(input.signal);
  const translation = await input.translateService.translateCrawlerData(
    aggregation.data,
    input.configuration,
    input.signal,
  );
  throwIfAborted(input.signal);
  return {
    aggregation,
    crawlerData: canonicalizeCrawlerDataActorAliases(translation.data, input.configuration),
    translationError: translation.error,
  };
};

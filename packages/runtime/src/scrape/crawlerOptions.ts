import type { Configuration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerOptions } from "../crawler/base/types";

interface BuildCrawlerOptionsInput {
  site: Website;
  configuration: Configuration;
  signal?: AbortSignal;
}

export const buildCrawlerOptions = ({ site, configuration, signal }: BuildCrawlerOptionsInput): CrawlerOptions => {
  const options: CrawlerOptions = {
    timeoutMs: Math.max(1, Math.trunc(configuration.network.timeout * 1000)),
  };

  const javdbCookie = configuration.network.javdbCookie.trim();
  if (site === Website.JAVDB && javdbCookie) {
    options.cookies = javdbCookie;
  }

  const javbusCookie = configuration.network.javbusCookie.trim();
  if (site === Website.JAVBUS && javbusCookie) {
    options.cookies = javbusCookie;
  }

  if (site === Website.R18_DEV) {
    options.r18MetadataLanguage = configuration.scrape.r18MetadataLanguage;
  }

  if (signal) {
    options.signal = signal;
  }

  return options;
};

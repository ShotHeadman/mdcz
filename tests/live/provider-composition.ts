import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import { NetworkClient } from "@mdcz/runtime/network";

/**
 * Production crawler composition used by Server scrape/tools runtimes.
 * Live provider tests must use this path — not Server/Electron process launch.
 */
export const createProductionCrawlerProvider = (): CrawlerProvider => {
  const networkClient = new NetworkClient();
  return new CrawlerProvider({
    fetchGateway: new FetchGateway(networkClient),
    siteRequestConfigRegistrar: networkClient,
  });
};

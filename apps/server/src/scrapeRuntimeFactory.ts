import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import type { NetworkClient } from "@mdcz/runtime/network";
import { AggregationService, MountedRootScrapeRuntime } from "@mdcz/runtime/scrape";
import type { ServerConfigService } from "./configService";

export const createServerScrapeRuntime = (
  config: ServerConfigService,
  networkClient: NetworkClient,
): MountedRootScrapeRuntime =>
  new MountedRootScrapeRuntime(
    config,
    new AggregationService(new CrawlerProvider({ fetchGateway: new FetchGateway(networkClient) })),
    console,
    networkClient,
  );

import { attachNetworkFixtureCaseId } from "@mdcz/runtime/network/networkFixtureCase";
import { createNetworkFixtureClient, finalizeNetworkFixtures } from "@mdcz/runtime/network/networkFixtureFactory";
import { ServerConfigService } from "./services/configService";
import { startServer } from "./startServer";

const config = new ServerConfigService();
const networkClient = createNetworkFixtureClient({
  getProxyUrl: () => config.getComputed().proxyUrl,
  getTimeoutMs: () => config.getComputed().networkTimeoutMs,
  getRetryCount: () => config.getComputed().networkRetryCount,
});

void startServer(
  { services: { config }, resources: { networkClient, prepareScrapeItem: attachNetworkFixtureCaseId } },
  finalizeNetworkFixtures,
);

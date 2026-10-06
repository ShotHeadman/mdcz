import { resolveSiteProxyUrl } from "@mdcz/runtime/config";
import { attachNetworkFixtureCaseId } from "@mdcz/runtime/network/networkFixtureCase";
import { createDevNetworkClient } from "@mdcz/runtime/network/networkFixtureFactory";
import { ServerConfigService } from "./services/configService";
import { startServer } from "./startServer";

const config = new ServerConfigService();
const networkClient = createDevNetworkClient({
  getProxyUrl: (site) => resolveSiteProxyUrl(config.getComputed(), site),
  getTimeoutMs: () => config.getComputed().networkTimeoutMs,
  getRetryCount: () => config.getComputed().networkRetryCount,
});

void startServer({ services: { config }, resources: { networkClient, prepareScrapeItem: attachNetworkFixtureCaseId } });

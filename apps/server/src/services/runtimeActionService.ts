import { type CrawlerProvider, probeSiteConnectivity } from "@mdcz/runtime/crawler";
import { checkConfiguredSiteCookies, type NetworkClient } from "@mdcz/runtime/network";
import { ensureWatermarkDirectory, LlmApiClient } from "@mdcz/runtime/scrape";
import { testLlmConnectivity } from "@mdcz/runtime/translate";
import type {
  AppEnsureWatermarkDirectoryResponse,
  CrawlerListSitesResponse,
  CrawlerProbeSiteConnectivityInput,
  NetworkCheckCookiesResponse,
  SiteConnectivityProbeResponse,
  TranslateTestLlmInputDto,
  TranslateTestLlmResponse,
} from "@mdcz/shared/serverDtos";
import type { ServerConfigService } from "./configService";

export class RuntimeActionService {
  private readonly llmApiClient: LlmApiClient;

  constructor(
    private readonly config: ServerConfigService,
    private readonly networkClient: NetworkClient,
    private readonly crawlerProvider: CrawlerProvider,
  ) {
    this.llmApiClient = new LlmApiClient(networkClient);
  }

  async ensureWatermarkDirectory(): Promise<AppEnsureWatermarkDirectoryResponse> {
    return {
      path: await ensureWatermarkDirectory(this.config.runtimePaths.dataDir),
    };
  }

  async listCrawlerSites(): Promise<CrawlerListSitesResponse> {
    const configuration = await this.config.get();
    const enabledSites = new Set(configuration.scrape.sites);
    return {
      sites: this.crawlerProvider.listSites().map(({ site, native }) => ({
        site,
        name: site,
        enabled: enabledSites.has(site),
        native,
      })),
    };
  }

  async probeSiteConnectivity(input: CrawlerProbeSiteConnectivityInput): Promise<SiteConnectivityProbeResponse> {
    return await probeSiteConnectivity(input.site, await this.config.get(), this.networkClient);
  }

  async checkCookies(): Promise<NetworkCheckCookiesResponse> {
    return await checkConfiguredSiteCookies(await this.config.get(), this.networkClient);
  }

  async testLlm(input: TranslateTestLlmInputDto): Promise<TranslateTestLlmResponse> {
    return await testLlmConnectivity(input, await this.config.get(), this.llmApiClient);
  }
}

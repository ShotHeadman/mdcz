import { type CrawlerProvider, probeSiteConnectivity } from "@mdcz/runtime/crawler";
import { checkConfiguredSiteCookies, type NetworkClient } from "@mdcz/runtime/network";
import { ensureWatermarkDirectory } from "@mdcz/runtime/scrape";
import { testTranslation } from "@mdcz/runtime/translate";
import type {
  AppEnsureWatermarkDirectoryResponse,
  CrawlerListSitesResponse,
  CrawlerProbeSiteConnectivityInput,
  NetworkCheckCookiesResponse,
  SiteConnectivityProbeResponse,
  TranslateTestInputDto,
  TranslateTestResponse,
} from "@mdcz/shared/serverDtos";
import type { ServerConfigService } from "./configService";

export class RuntimeActionService {
  constructor(
    private readonly config: ServerConfigService,
    private readonly networkClient: NetworkClient,
    private readonly crawlerProvider: CrawlerProvider,
  ) {}

  async ensureWatermarkDirectory(): Promise<AppEnsureWatermarkDirectoryResponse> {
    return {
      path: await ensureWatermarkDirectory(this.config.runtimePaths.dataDir),
    };
  }

  async listCrawlerSites(): Promise<CrawlerListSitesResponse> {
    return { sites: this.crawlerProvider.listSites((await this.config.get()).scrape.sites) };
  }

  async probeSiteConnectivity(input: CrawlerProbeSiteConnectivityInput): Promise<SiteConnectivityProbeResponse> {
    const result = await probeSiteConnectivity(input.site, await this.config.get(), this.networkClient);
    if (result.ok) this.crawlerProvider.resetSite(input.site);
    return result;
  }

  async checkCookies(): Promise<NetworkCheckCookiesResponse> {
    return await checkConfiguredSiteCookies(await this.config.get(), this.networkClient);
  }

  async testTranslation(input: TranslateTestInputDto): Promise<TranslateTestResponse> {
    return await testTranslation(input, await this.config.get(), this.networkClient);
  }
}

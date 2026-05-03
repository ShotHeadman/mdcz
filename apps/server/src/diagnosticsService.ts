import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import { probeMediaServer as probeRuntimeMediaServer } from "@mdcz/runtime/mediaserver";
import { NetworkClient } from "@mdcz/runtime/network";
import { isMissingRequiredLlmApiKey, TranslateService, toTarget } from "@mdcz/runtime/translate";
import { toErrorMessage } from "@mdcz/shared/error";
import type { DiagnosticCheckDto, DiagnosticsSummaryResponse } from "@mdcz/shared/serverDtos";
import type { ServerConfigService } from "./configService";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";

export class DiagnosticsService {
  private readonly networkClient = new NetworkClient();
  private readonly crawlerProvider = new CrawlerProvider({ fetchGateway: new FetchGateway(this.networkClient) });
  private readonly translate = new TranslateService(this.networkClient);

  constructor(
    private readonly persistence: ServerPersistenceService,
    private readonly mediaRoots: MediaRootService,
    private readonly config: ServerConfigService,
  ) {}

  async summary(): Promise<DiagnosticsSummaryResponse> {
    const checkedAt = new Date().toISOString();
    const persistence = {
      id: "persistence",
      label: "持久化",
      ok: this.persistence.initialized,
      message: this.persistence.databasePath,
      checkedAt,
    };
    const roots = await this.mediaRoots.list();
    const rootChecks = await Promise.all(
      roots.roots.map(async (root) => {
        if (!root.enabled) {
          return {
            id: `media-root:${root.id}`,
            label: root.displayName,
            ok: false,
            message: "媒体目录已停用",
            checkedAt,
          };
        }

        const availability = await this.mediaRoots.availability(root.id);
        return {
          id: `media-root:${root.id}`,
          label: root.displayName,
          ok: availability.availability.available,
          message: availability.availability.error ?? root.hostPath,
          checkedAt: availability.availability.checkedAt,
        };
      }),
    );
    const [crawler, cookie, translate, jellyfin, emby] = await Promise.all([
      this.probeCrawlerRuntime(),
      this.probeNetworkCookies(),
      this.probeTranslateConfig(),
      this.probeMediaServer("jellyfin"),
      this.probeMediaServer("emby"),
    ]);

    return { checks: [persistence, ...rootChecks, crawler, cookie, translate, jellyfin, emby] };
  }

  async probeMediaServer(server: "emby" | "jellyfin"): Promise<DiagnosticCheckDto> {
    const checkedAt = new Date().toISOString();
    const config = await this.config.get();
    const label = server === "emby" ? "Emby 连接" : "Jellyfin 连接";
    const result = await probeRuntimeMediaServer(this.networkClient, config, server);
    return {
      id: `media-server:${server}`,
      label,
      ok: result.ok,
      message: result.message,
      checkedAt,
      detail: { serverName: result.serverName, version: result.version, personCount: result.personCount },
    };
  }

  private async probeCrawlerRuntime(): Promise<DiagnosticCheckDto> {
    const checkedAt = new Date().toISOString();
    const sites = this.crawlerProvider.listSites();
    const nativeCount = sites.filter((site) => site.native).length;
    return {
      id: "crawler-runtime",
      label: "爬虫运行时",
      ok: nativeCount > 0,
      message: `${nativeCount}/${sites.length} 个站点已注册 Node.js 爬虫`,
      checkedAt,
      detail: { nativeSites: sites.filter((site) => site.native).map((site) => site.site) },
    };
  }

  private async probeNetworkCookies(): Promise<DiagnosticCheckDto> {
    const checkedAt = new Date().toISOString();
    const config = await this.config.get();
    const javdbConfigured = config.network.javdbCookie.trim().length > 0;
    const javbusConfigured = config.network.javbusCookie.trim().length > 0;
    const targets = [
      javdbConfigured ? { label: "JavDB", url: "https://javdb.com/", cookie: config.network.javdbCookie } : null,
      javbusConfigured
        ? { label: "JavBus", url: "https://www.javbus.com/", cookie: config.network.javbusCookie }
        : null,
    ].filter((item): item is { label: string; url: string; cookie: string } => item !== null);

    if (targets.length > 0) {
      const results = await Promise.all(
        targets.map(async (target) => {
          try {
            const response = await this.networkClient.head(target.url, {
              headers: { cookie: target.cookie },
              timeout: Math.max(1, Math.trunc(config.network.timeout * 1000)),
            });
            return `${target.label}: HTTP ${response.status}`;
          } catch (error) {
            return `${target.label}: ${toErrorMessage(error)}`;
          }
        }),
      );
      return {
        id: "network-cookie",
        label: "站点 Cookie",
        ok: results.some((item) => /HTTP 2\d\d|HTTP 3\d\d/u.test(item)),
        message: results.join(" / "),
        checkedAt,
        detail: { javdbConfigured, javbusConfigured },
      };
    }

    return {
      id: "network-cookie",
      label: "站点 Cookie",
      ok: javdbConfigured || javbusConfigured,
      message:
        javdbConfigured || javbusConfigured
          ? `已配置 ${[javdbConfigured ? "JavDB" : "", javbusConfigured ? "JavBus" : ""].filter(Boolean).join(" / ")} Cookie`
          : "未配置 JavDB / JavBus Cookie；公开站点仍可尝试访问",
      checkedAt,
      detail: { javdbConfigured, javbusConfigured },
    };
  }

  private async probeTranslateConfig(): Promise<DiagnosticCheckDto> {
    const checkedAt = new Date().toISOString();
    const config = await this.config.get();
    const translate = config.translate;
    const baseUrl = translate.llmBaseUrl.trim();
    const model = translate.llmModelName.trim();
    const hasApiKey = translate.llmApiKey.trim().length > 0;

    if (translate.engine === "google") {
      return {
        id: "translate-llm",
        label: "翻译配置",
        ok: true,
        message: "当前使用 Google 翻译引擎",
        checkedAt,
      };
    }

    if (!baseUrl || !model || isMissingRequiredLlmApiKey(baseUrl, translate.llmApiKey)) {
      return {
        id: "translate-llm",
        label: "翻译 LLM",
        ok: false,
        message: "LLM base URL、模型名或 API Key 未完整配置",
        checkedAt,
        detail: { baseUrl, model, hasApiKey },
      };
    }

    try {
      const translated = await this.translate.translateText(
        "connection test",
        toTarget(translate.targetLanguage),
        config,
      );
      return {
        id: "translate-llm",
        label: "翻译 LLM",
        ok: Boolean(translated?.trim()),
        message: translated?.trim() ? `${model} 响应正常` : `${model} 未返回翻译内容`,
        checkedAt,
        detail: { baseUrl, model, hasApiKey },
      };
    } catch (error) {
      return {
        id: "translate-llm",
        label: "翻译 LLM",
        ok: false,
        message: toErrorMessage(error),
        checkedAt,
        detail: { baseUrl, model, hasApiKey },
      };
    }
  }
}

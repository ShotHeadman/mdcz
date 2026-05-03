import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import { LocalScanService, writePreparedNfo } from "@mdcz/runtime/maintenance";
import { type MediaServerKey, syncMediaServerPersonInfo, syncMediaServerPersonPhotos } from "@mdcz/runtime/mediaserver";
import { NetworkClient } from "@mdcz/runtime/network";
import { AggregationService, LlmApiClient, NfoGenerator, TranslateService, toTarget } from "@mdcz/runtime/scrape";
import {
  applyAmazonPosters,
  applyBatchNfoTranslations,
  cleanFilesByExtension,
  createSymlinks,
  findMissingNumbers,
  lookupAmazonPoster,
  scanAmazonPosters,
  scanBatchNfoTranslations,
} from "@mdcz/runtime/tools";
import { validateManualScrapeUrl } from "@mdcz/shared/manualScrapeUrl";
import type { ToolCatalogResponse, ToolExecuteInput, ToolExecuteResponse } from "@mdcz/shared/serverDtos";
import { TOOL_DEFINITIONS } from "@mdcz/shared/toolCatalog";
import type { ActorProfile } from "@mdcz/shared/types";
import { resolveRootRelativePath } from "@mdcz/storage";
import type { ServerConfigService } from "./configService";
import type { DiagnosticsService } from "./diagnosticsService";
import type { LibraryService } from "./libraryService";
import type { MediaRootService } from "./mediaRootService";
import type { ScrapeService } from "./scrapeService";

export class ToolsService {
  private readonly networkClient = new NetworkClient();
  private readonly aggregation = new AggregationService(
    new CrawlerProvider({ fetchGateway: new FetchGateway(this.networkClient) }),
  );
  private readonly translate = new TranslateService(this.networkClient);
  private readonly localScanService = new LocalScanService();
  private readonly llmApiClient = new LlmApiClient(this.networkClient);
  private readonly nfoGenerator = new NfoGenerator();

  constructor(
    private readonly config: ServerConfigService,
    private readonly mediaRoots: MediaRootService,
    private readonly scrape: ScrapeService,
    private readonly diagnostics: DiagnosticsService,
    private readonly library?: LibraryService,
  ) {}

  catalog(): ToolCatalogResponse {
    return {
      tools: TOOL_DEFINITIONS.map((tool) => ({
        id: tool.id,
      })),
    };
  }

  async execute(input: ToolExecuteInput): Promise<ToolExecuteResponse> {
    switch (input.toolId) {
      case "single-file-scraper": {
        const task = await this.scrape.start({
          refs: [{ rootId: input.rootId, relativePath: input.relativePath }],
          manualUrl: input.manualUrl,
          uncensoredConfirmed: true,
        });
        return { toolId: input.toolId, ok: true, message: `已创建刮削任务 ${task.id}`, data: task };
      }
      case "crawler-tester": {
        const config = await this.config.get();
        const manual = input.manualUrl ? validateManualScrapeUrl(input.manualUrl) : null;
        if (manual && !manual.valid) {
          return { toolId: input.toolId, ok: false, message: manual.message };
        }
        const result = await this.aggregation.aggregate(
          input.number,
          config,
          undefined,
          manual?.valid
            ? { site: manual.route.site, detailUrl: manual.route.detailUrl }
            : input.site
              ? { site: input.site }
              : undefined,
        );
        if (!result) {
          return { toolId: input.toolId, ok: false, message: "未抓取到可聚合结果" };
        }
        return {
          toolId: input.toolId,
          ok: true,
          message: `爬虫测试完成：${result.stats.successCount}/${result.stats.totalSites} 成功`,
          data: result,
        };
      }
      case "media-library-tools": {
        const server = input.server as MediaServerKey;
        if (input.action === "sync-info") {
          const config = await this.config.get();
          const result = await syncMediaServerPersonInfo(
            this.networkClient,
            config,
            server,
            await this.collectActorProfiles(),
            input.mode,
          );
          return {
            toolId: input.toolId,
            ok: result.failedCount === 0,
            message: `人物简介同步完成：${result.processedCount} 成功，${result.skippedCount} 跳过，${result.failedCount} 失败`,
            data: result,
          };
        }
        if (input.action === "sync-photo") {
          const config = await this.config.get();
          const result = await syncMediaServerPersonPhotos(
            this.networkClient,
            config,
            server,
            await this.collectActorProfiles(),
            input.mode,
          );
          return {
            toolId: input.toolId,
            ok: result.failedCount === 0,
            message: `人物头像同步完成：${result.processedCount} 成功，${result.skippedCount} 跳过，${result.failedCount} 失败`,
            data: result,
          };
        }
        const check = await this.diagnostics.probeMediaServer(input.server);
        return { toolId: input.toolId, ok: check.ok, message: check.message, data: check };
      }
      case "symlink-manager": {
        const result = await createSymlinks(input);
        return {
          toolId: input.toolId,
          ok: result.failed === 0,
          message: input.dryRun
            ? `预览完成：${result.planned.length} 个目标可创建`
            : `软链接完成：${result.linked} 链接，${result.copied} 复制，${result.failed} 失败`,
          data: result,
        };
      }
      case "file-cleaner": {
        const root = await this.mediaRoots.getActiveRoot(input.rootId);
        const rootDir = resolveRootRelativePath(root, input.relativePath ?? "");
        const result = await cleanFilesByExtension({
          rootDir,
          extensions: input.extensions,
          dryRun: input.dryRun,
          recursive: input.recursive,
        });
        return {
          toolId: input.toolId,
          ok: true,
          message: input.dryRun ? `预览到 ${result.matched} 个文件` : `已删除 ${result.deleted} 个文件`,
          data: result,
        };
      }
      case "batch-nfo-translator": {
        const config = await this.config.get();
        if (input.action === "scan") {
          if (!input.directory) {
            return { toolId: input.toolId, ok: false, message: "请选择要扫描的目录。" };
          }
          const items = await scanBatchNfoTranslations(input.directory, config, {
            localScanService: this.localScanService,
          });
          return { toolId: input.toolId, ok: true, message: `扫描到 ${items.length} 个待翻译 NFO`, data: { items } };
        }
        if (input.action === "apply") {
          const items = input.items ?? [];
          const results = await applyBatchNfoTranslations(items, config, {
            llmApiClient: this.llmApiClient,
            localScanService: this.localScanService,
            nfoGenerator: this.nfoGenerator,
            writeNfo: writePreparedNfo,
          });
          return {
            toolId: input.toolId,
            ok: results.every((item) => item.success),
            message: `批量翻译完成：${results.filter((item) => item.success).length}/${results.length} 成功`,
            data: { results },
          };
        }
        if (!input.text) {
          return { toolId: input.toolId, ok: false, message: "请输入待翻译文本。" };
        }
        const translated = await this.translate.translateText(
          input.text,
          toTarget(config.translate.targetLanguage),
          config,
        );
        return { toolId: input.toolId, ok: true, message: "翻译完成", data: { translated } };
      }
      case "missing-number-finder": {
        const result = findMissingNumbers(input);
        return { toolId: input.toolId, ok: true, message: `找到 ${result.total} 个缺失编号`, data: result };
      }
      case "amazon-poster": {
        if (input.action === "lookup") {
          if (!input.nfoPath || !input.title) {
            return { toolId: input.toolId, ok: false, message: "NFO 路径和标题不能为空。" };
          }
          const result = await lookupAmazonPoster(this.networkClient, input.nfoPath, input.title);
          return {
            toolId: input.toolId,
            ok: Boolean(result.amazonPosterUrl),
            message: result.reason,
            data: result,
          };
        }
        if (input.action === "apply") {
          const results = await applyAmazonPosters(this.networkClient, input.items ?? []);
          return {
            toolId: input.toolId,
            ok: results.every((item) => item.success),
            message: `海报写入完成：${results.filter((item) => item.success).length}/${results.length} 成功`,
            data: { results },
          };
        }
        if (!input.rootDir) {
          return { toolId: input.toolId, ok: false, message: "请选择要扫描的目录。" };
        }
        const items = await scanAmazonPosters(input.rootDir);
        return { toolId: input.toolId, ok: true, message: `扫描到 ${items.length} 个 NFO 条目`, data: { items } };
      }
    }
  }

  private async collectActorProfiles(): Promise<ActorProfile[]> {
    if (!this.library) return [];
    const library = await this.library.list({ limit: 500 });
    const profiles = new Map<string, ActorProfile>();
    for (const entry of library.entries) {
      for (const profile of entry.crawlerData?.actor_profiles ?? []) {
        const key = profile.name.trim().toLowerCase();
        if (key && !profiles.has(key)) {
          profiles.set(key, profile);
        }
      }
    }
    return [...profiles.values()];
  }
}

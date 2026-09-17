import type { ActorSourceProvider } from "@mdcz/runtime/actorSource";
import type { CrawlerProvider } from "@mdcz/runtime/crawler";
import { resolveDesktopInputRootPath } from "@mdcz/runtime/library";
import { LocalScanService, writePreparedNfo } from "@mdcz/runtime/maintenance";
import {
  EmbyActorInfoService,
  EmbyActorPhotoService,
  JellyfinActorInfoService,
  JellyfinActorPhotoService,
  type MediaServerKey,
  type MediaServerSignalService,
  probeMediaServer,
} from "@mdcz/runtime/mediaserver";
import type { NetworkClient } from "@mdcz/runtime/network";
import { registeredMediaLocations } from "@mdcz/runtime/publication";
import { AggregationService, LlmApiClient, NfoGenerator, TranslateService, toTarget } from "@mdcz/runtime/scrape";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
import {
  applyAmazonPosters,
  applyBatchNfoTranslations,
  createSymlinks,
  lookupAmazonPoster,
  scanAmazonPosters,
  scanBatchNfoTranslations,
} from "@mdcz/runtime/tools";
import { resolveManualScrapeRoute } from "@mdcz/shared/manualScrapeUrl";
import type { ToolCatalogResponse, ToolExecuteInput, ToolExecuteResponse } from "@mdcz/shared/serverDtos";
import { TOOL_DEFINITIONS } from "@mdcz/shared/toolCatalog";
import type { ServerConfigService } from "./configService";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";
import type { ScrapeService } from "./scrapeService";

const noopMediaServerSignal: MediaServerSignalService = {
  resetProgress: () => undefined,
  setProgress: () => undefined,
  showLogText: () => undefined,
};

export interface ToolsServiceDependencies {
  networkClient: NetworkClient;
  crawlerProvider: CrawlerProvider;
  actorSourceProvider: ActorSourceProvider;
}

export class ToolsService {
  private readonly networkClient: NetworkClient;
  private readonly actorSourceProvider: ActorSourceProvider;
  private readonly aggregation: AggregationService;
  private readonly translate: TranslateService;
  private readonly localScanService = new LocalScanService(async (paths) => {
    const state = await this.persistence.getState();
    return registeredMediaLocations(state.repositories.library, (id) => state.repositories.mediaRoots.get(id), paths);
  });
  private readonly llmApiClient: LlmApiClient;
  private readonly nfoGenerator = new NfoGenerator();

  constructor(
    private readonly config: ServerConfigService,
    private readonly mediaRoots: MediaRootService,
    private readonly scrape: ScrapeService,
    private readonly persistence: ServerPersistenceService,
    deps: ToolsServiceDependencies,
  ) {
    this.networkClient = deps.networkClient;
    this.actorSourceProvider = deps.actorSourceProvider;
    this.aggregation = new AggregationService(deps.crawlerProvider);
    this.translate = new TranslateService(deps.networkClient);
    this.llmApiClient = new LlmApiClient(deps.networkClient);
  }

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
          executionMode: "single",
          manualUrl: input.manualUrl,
          uncensoredConfirmed: true,
        });
        return { toolId: input.toolId, ok: true, message: `已创建刮削任务 ${task.task.id}`, data: task };
      }
      case "crawler-tester": {
        const config = await this.config.get();
        const result = await this.aggregation.aggregate(
          input.number,
          config,
          undefined,
          resolveManualScrapeRoute(input.manualUrl) ?? (input.site ? { site: input.site } : undefined),
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
        const server = input.server ?? "jellyfin";
        const action = input.action ?? "check";
        const mode = input.mode ?? "missing";
        if (action === "sync-info" || action === "sync-photo") {
          const config = await this.config.get();
          const result =
            action === "sync-info"
              ? await this.createActorInfoService(server).run(config, mode)
              : await this.createActorPhotoService(server).run(config, mode);
          const label = action === "sync-info" ? "人物简介同步完成" : "人物头像同步完成";
          return {
            toolId: input.toolId,
            ok: result.failedCount === 0,
            message: `${label}：${result.processedCount} 成功，${result.skippedCount} 跳过，${result.failedCount} 失败`,
            data: result,
          };
        }
        const config = await this.config.get();
        const check = await probeMediaServer(this.networkClient, config, server);
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
          if (items.length > 0) {
            await this.mediaRoots.ensurePathRecord({
              hostPath: resolveDesktopInputRootPath(items.map((item) => item.nfoPath)),
            });
          }
          const state = await this.persistence.getState();
          const results = await applyBatchNfoTranslations(
            items,
            config,
            {
              llmApiClient: this.llmApiClient,
              localScanService: this.localScanService,
              nfoGenerator: this.nfoGenerator,
              writeNfo: writePreparedNfo,
              publication: {
                journal: state.repositories.publicationJournal,
                outputs: state.repositories.library,
                library: state.repositories.library,
                repairIssues: state.repositories.libraryRepairIssues,
                roots: await this.mediaRoots.listRoots(),
              },
            },
            {
              maxBatchItems: input.batchSize,
            },
          );
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
      case "amazon-poster": {
        if (input.action === "lookup") {
          if (!input.nfoPath || !input.title) {
            return { toolId: input.toolId, ok: false, message: "NFO 路径和标题不能为空。" };
          }
          const result = await lookupAmazonPoster(this.networkClient, input.nfoPath, input.title, {
            logger: runtimeLoggerService.getLogger("AmazonJpImageService"),
          });
          return {
            toolId: input.toolId,
            ok: Boolean(result.amazonPosterUrl),
            message: result.reason,
            data: result,
          };
        }
        if (input.action === "apply") {
          const items = input.items ?? [];
          if (items.length > 0) {
            await this.mediaRoots.ensurePathRecord({
              hostPath: resolveDesktopInputRootPath(items.map((item) => item.nfoPath)),
            });
          }
          const state = await this.persistence.getState();
          const results = await applyAmazonPosters(this.networkClient, items, {
            journal: state.repositories.publicationJournal,
            outputs: state.repositories.library,
            library: state.repositories.library,
            repairIssues: state.repositories.libraryRepairIssues,
            roots: await this.mediaRoots.listRoots(),
          });
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

  private actorServiceDeps(server: MediaServerKey) {
    return {
      signalService: noopMediaServerSignal,
      networkClient: this.networkClient,
      actorSourceProvider: this.actorSourceProvider,
      logger: runtimeLoggerService.getLogger(server === "emby" ? "EmbyActorSync" : "JellyfinActorSync"),
    };
  }

  private createActorInfoService(server: MediaServerKey) {
    const deps = this.actorServiceDeps(server);
    return server === "emby" ? new EmbyActorInfoService(deps) : new JellyfinActorInfoService(deps);
  }

  private createActorPhotoService(server: MediaServerKey) {
    const deps = this.actorServiceDeps(server);
    return server === "emby" ? new EmbyActorPhotoService(deps) : new JellyfinActorPhotoService(deps);
  }
}

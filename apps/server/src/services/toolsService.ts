import { registeredMediaLocations } from "@mdcz/runtime";
import type { ActorSourceProvider } from "@mdcz/runtime/actorSource";
import type { CrawlerProvider } from "@mdcz/runtime/crawler";
import { resolveDesktopInputRootPath } from "@mdcz/runtime/library";
import { LocalScanService, writePreparedNfo } from "@mdcz/runtime/maintenance";
import {
  checkEmbyConnection,
  checkJellyfinConnection,
  EmbyActorInfoService,
  EmbyActorPhotoService,
  JellyfinActorInfoService,
  JellyfinActorPhotoService,
  type MediaServerKey,
  type MediaServerSignalService,
} from "@mdcz/runtime/mediaserver";
import type { NetworkClient } from "@mdcz/runtime/network";
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
  private readonly crawlerProvider: CrawlerProvider;
  private readonly actorSourceProvider: ActorSourceProvider;
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
    this.crawlerProvider = deps.crawlerProvider;
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
          libraryId: input.libraryId,
          manualUrl: input.manualUrl,
          unpin: input.unpin,
        });
        return { toolId: input.toolId, ok: true, data: task };
      }
      case "crawler-tester": {
        const config = await this.config.get();
        const result = await new AggregationService(this.crawlerProvider, { config }).aggregate(input.number, {
          manualScrape:
            resolveManualScrapeRoute(input.manualUrl, config.network) ??
            (input.site ? { site: input.site } : undefined),
        });
        return { toolId: input.toolId, ok: true, data: result };
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
          return { toolId: input.toolId, ok: result.failedCount === 0, data: result };
        }
        const config = await this.config.get();
        const check =
          server === "emby"
            ? await checkEmbyConnection(this.networkClient, config)
            : await checkJellyfinConnection(this.networkClient, config);
        return { toolId: input.toolId, ok: check.success, data: check };
      }
      case "symlink-manager": {
        const result = await createSymlinks(input);
        return { toolId: input.toolId, ok: result.failed === 0, data: result };
      }
      case "batch-nfo-translator": {
        const config = await this.config.get();
        if (input.action === "scan") {
          if (!input.directory) throw new Error("Batch NFO translation scan requires a directory");
          if (!input.mode) throw new Error("Batch NFO translation scan requires a mode");
          const items = await scanBatchNfoTranslations(input.directory, input.mode, config, {
            localScanService: this.localScanService,
          });
          return { toolId: input.toolId, ok: true, data: { items } };
        }
        if (input.action === "apply") {
          if (!input.mode) throw new Error("Batch NFO translation apply requires a mode");
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
                outputs: state.repositories.library,
                library: state.repositories.library,
                roots: await this.mediaRoots.listRoots(),
              },
            },
            { mode: input.mode, maxBatchItems: input.batchSize },
          );
          return { toolId: input.toolId, ok: results.every((item) => item.success), data: { results } };
        }
        if (!input.text) throw new Error("Text translation requires text");
        const translated = await this.translate.translateText(
          input.text,
          toTarget(config.translate.targetLanguage),
          config,
        );
        return { toolId: input.toolId, ok: true, data: { translated } };
      }
      case "amazon-poster": {
        if (input.action === "lookup") {
          if (!input.nfoPath || !input.title) throw new Error("Amazon poster lookup requires an NFO path and title");
          const result = await lookupAmazonPoster(this.networkClient, input.nfoPath, input.title, {
            logger: runtimeLoggerService.getLogger("AmazonJpImageService"),
          });
          return { toolId: input.toolId, ok: Boolean(result.amazonPosterUrl), data: result };
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
            outputs: state.repositories.library,
            library: state.repositories.library,
            roots: await this.mediaRoots.listRoots(),
          });
          return { toolId: input.toolId, ok: results.every((item) => item.success), data: { results } };
        }
        if (!input.rootDir) throw new Error("Amazon poster scan requires a root directory");
        const items = await scanAmazonPosters(input.rootDir);
        return { toolId: input.toolId, ok: true, data: { items } };
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

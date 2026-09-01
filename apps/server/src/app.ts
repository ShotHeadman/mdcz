import { existsSync } from "node:fs";
import path from "node:path";
import type { ActorSourceProvider } from "@mdcz/runtime/actorSource";
import { PersistentCooldownStore } from "@mdcz/runtime/cooldown";
import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import { NetworkClient } from "@mdcz/runtime/network";
import { ActorImageService } from "@mdcz/runtime/scrape";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
import type { FileTranslationMappingStore } from "@mdcz/runtime/translate";
import { automationRecentInputSchema, automationScrapeStartInputSchema } from "@mdcz/shared/serverDtos";
import { type CreateFastifyContextOptions, fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyInstance } from "fastify";
import { createServerActorSourceProvider, serverActorImageCacheRoot } from "./actorSourceFactory";
import { getBearerToken } from "./http/auth";
import { applyCorsHeaders } from "./http/cors";
import { createHealthPayload } from "./http/health";
import { registerLibraryAssets } from "./http/libraryAssets";
import { writeTaskEventsStream } from "./http/sse";
import { defaultWebStaticDir, registerStaticWeb } from "./http/staticWeb";
import { createServerMaintenanceRuntime } from "./maintenanceRuntimeFactory";
import { appRouter } from "./routers";
import { createServerScrapeRuntime } from "./scrapeRuntimeFactory";
import type { ServerServiceOptions, ServerServices } from "./services";
import { AuthService } from "./services/authService";
import { AutomationService } from "./services/automationService";
import { BrowserService } from "./services/browserService";
import { ServerConfigService } from "./services/configService";
import { LibraryService } from "./services/libraryService";
import { MaintenanceService } from "./services/maintenanceService";
import { MediaRootService } from "./services/mediaRootService";
import { ServerPersistenceService } from "./services/persistenceService";
import { RuntimeActionService } from "./services/runtimeActionService";
import { RuntimeLogService } from "./services/runtimeLogService";
import { ScanQueueService } from "./services/scanQueueService";
import { ScrapeService } from "./services/scrapeService";
import { ServerPathService } from "./services/serverPathService";
import { SystemService } from "./services/systemService";
import { ToolsService } from "./services/toolsService";
import { createTaskEventBus } from "./taskEvents";
import { createServerTranslationMappingStore } from "./translationMappingStore";

export interface ServerResourceOverrides {
  networkClient?: NetworkClient;
  fetchGateway?: FetchGateway;
  crawlerProvider?: CrawlerProvider;
  imageHostCooldownStore?: PersistentCooldownStore;
  actorImageService?: ActorImageService;
  actorSourceProvider?: ActorSourceProvider;
  mappingStore?: FileTranslationMappingStore;
}

export interface BuildServerOptions {
  serviceOptions?: ServerServiceOptions;
  services?: Partial<ServerServices>;
  resources?: ServerResourceOverrides;
  webStaticDir?: string | false;
}

export interface ServerApp {
  fastify: FastifyInstance;
  services: ServerServices;
}

export const buildServer = (options: BuildServerOptions = {}): ServerApp => {
  const config = options.services?.config ?? new ServerConfigService();
  const persistence = options.services?.persistence ?? new ServerPersistenceService(config.runtimePaths);
  const taskEvents = options.services?.taskEvents ?? createTaskEventBus();
  const mediaRoots = options.services?.mediaRoots ?? new MediaRootService(persistence);
  const runtimeLogs = options.services?.runtimeLogs ?? new RuntimeLogService(1000, taskEvents);
  const reportUnavailableMediaPath = (hostPath: string, error: unknown) => {
    config.reportDiagnostic(
      "read-error",
      new Error(`Configured media root unavailable: ${hostPath}: ${String(error)}`),
    );
  };
  config.setBeforeActiveConfigurationCommit(async (next, { source }) => {
    await mediaRoots.assertConfiguredMediaPath(
      next,
      source === "load" || source === "watch" ? reportUnavailableMediaPath : undefined,
    );
  });
  config.setAfterActiveConfigurationCommit(async (next, { source }) => {
    await mediaRoots.registerConfiguredMediaPath(
      next,
      source === "load" || source === "watch" ? reportUnavailableMediaPath : undefined,
    );
  });
  config.onDiagnostic((event) => {
    runtimeLogs
      .getLogger("config")
      .warn(`Configuration ${event.kind} for profile ${event.profileName}: ${event.message}`);
  });
  runtimeLoggerService.setFactory((name) => runtimeLogs.getLogger(name));
  const mappingStore = options.resources?.mappingStore ?? createServerTranslationMappingStore(config);
  const networkClient =
    options.resources?.networkClient ??
    new NetworkClient({
      getProxyUrl: () => config.getComputed().proxyUrl,
      getTimeoutMs: () => config.getComputed().networkTimeoutMs,
      getRetryCount: () => config.getComputed().networkRetryCount,
    });
  const fetchGateway = options.resources?.fetchGateway ?? new FetchGateway(networkClient);
  const crawlerProvider =
    options.resources?.crawlerProvider ??
    new CrawlerProvider({
      fetchGateway,
      siteRequestConfigRegistrar: networkClient,
    });
  const imageHostCooldownStore =
    options.resources?.imageHostCooldownStore ??
    new PersistentCooldownStore({
      filePath: path.join(config.runtimePaths.dataDir, "image-host-cooldowns.json"),
      logger: runtimeLoggerService.getLogger("ImageHostCooldownStore"),
    });
  const actorImageService =
    options.resources?.actorImageService ??
    new ActorImageService({
      cacheRoot: serverActorImageCacheRoot(config),
      logger: runtimeLoggerService.getLogger("ActorImageService"),
      networkClient,
    });
  const actorSourceProvider =
    options.resources?.actorSourceProvider ?? createServerActorSourceProvider(networkClient, actorImageService);
  const scrape =
    options.services?.scrape ??
    new ScrapeService(persistence, mediaRoots, config, taskEvents, {
      networkClient,
      runtime: createServerScrapeRuntime({
        config,
        networkClient,
        crawlerProvider,
        imageHostCooldownStore,
        actorImageService,
        actorSourceProvider,
        mappingStore,
      }),
      imageHostCooldownStore,
    });
  const library = options.services?.library ?? new LibraryService(persistence, mediaRoots);
  const maintenance =
    options.services?.maintenance ??
    new MaintenanceService(
      persistence,
      mediaRoots,
      taskEvents,
      createServerMaintenanceRuntime({
        config,
        networkClient,
        crawlerProvider,
        imageHostCooldownStore,
        actorImageService,
        actorSourceProvider,
        mappingStore,
      }),
    );
  const scans = options.services?.scans ?? new ScanQueueService(persistence, mediaRoots, taskEvents);
  const system = options.services?.system ?? new SystemService();
  const services: ServerServices = {
    automation:
      options.services?.automation ??
      new AutomationService(scans, scrape, maintenance, taskEvents, options.serviceOptions?.automationWebhook),
    auth: options.services?.auth ?? new AuthService(config.runtimePaths),
    browser: options.services?.browser ?? new BrowserService(mediaRoots),
    config,
    library,
    maintenance,
    mediaRoots,
    persistence,
    runtimeLogs,
    runtimeActions:
      options.services?.runtimeActions ?? new RuntimeActionService(config, networkClient, crawlerProvider),
    scans,
    scrape,
    serverPaths: options.services?.serverPaths ?? new ServerPathService(mediaRoots, config),
    system,
    taskEvents,
    tools:
      options.services?.tools ??
      new ToolsService(config, mediaRoots, scrape, persistence, {
        networkClient,
        crawlerProvider,
        actorSourceProvider,
      }),
  };
  const fastify = Fastify({
    logger: false,
  });

  fastify.addHook("onReady", async () => {
    await services.config.load();
    await services.config.startWatching();
    await services.persistence.initialize();
    await services.scans.recoverInterrupted();
  });

  let closed = false;
  fastify.addHook("onClose", async () => {
    if (closed) return;
    closed = true;
    await services.config.stopWatching();
    await services.scans.close();
    await services.scrape.close();
    await services.maintenance.close();
    await crawlerProvider.shutdown();
    await imageHostCooldownStore.flush();
    await services.persistence.close();
  });

  fastify.addHook("onRequest", async (request, reply) => {
    applyCorsHeaders(request, reply);
    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });

  const webStaticDir =
    options.webStaticDir === false ? null : path.resolve(options.webStaticDir ?? defaultWebStaticDir());
  const hasStaticWeb = Boolean(webStaticDir && existsSync(path.join(webStaticDir, "index.html")));
  if (!hasStaticWeb) {
    fastify.get("/", async () => createHealthPayload());
  }
  fastify.get("/health", async () => createHealthPayload());

  fastify.get("/api/automation/library/recent", async (request) => {
    services.auth.assertAuthenticated(getBearerToken(request));
    const input = automationRecentInputSchema.parse(request.query);
    return await services.automation.recent(input);
  });

  fastify.get("/api/automation/webhooks/status", async (request) => {
    services.auth.assertAuthenticated(getBearerToken(request));
    return services.automation.deliveryStatus();
  });

  fastify.post("/api/automation/scrape/start", async (request) => {
    services.auth.assertAuthenticated(getBearerToken(request));
    const input = automationScrapeStartInputSchema.parse(request.body);
    return await services.automation.scrapeStart(input);
  });

  fastify.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      allowMethodOverride: true,
      createContext: ({ req }: CreateFastifyContextOptions) => ({ services, token: getBearerToken(req) }),
    },
  });

  fastify.get("/events/tasks", async (request, reply) => {
    services.auth.assertAuthenticated(getBearerToken(request));
    reply.hijack();
    await writeTaskEventsStream(services, reply.raw, request.headers.origin, request.headers.host);
  });

  registerLibraryAssets(fastify, services);

  if (hasStaticWeb && webStaticDir) {
    registerStaticWeb(fastify, webStaticDir);
  }

  return {
    fastify,
    services,
  };
};

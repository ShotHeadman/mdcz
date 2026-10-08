import { existsSync } from "node:fs";
import path from "node:path";
import type { ActorSourceProvider } from "@mdcz/runtime/actorSource";
import { resolveSiteProxyUrl, siteNetworkKey } from "@mdcz/runtime/config";
import { PersistentCooldownStore } from "@mdcz/runtime/cooldown";
import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import { MediaLibraryService, PendingService } from "@mdcz/runtime/library";
import { NetworkClient } from "@mdcz/runtime/network";
import { ActorImageService, type PrepareScrapeItem } from "@mdcz/runtime/scrape";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
import type { FileTranslationMappingStore } from "@mdcz/runtime/translate";
import {
  automationRecentInputSchema,
  automationScrapeStartInputSchema,
  cloudDriveNotifySchema,
} from "@mdcz/shared/serverDtos";
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
import type { ServerServices } from "./services";
import { ActivityService } from "./services/activityService";
import { AuthenticationError, AuthService } from "./services/authService";
import { AutomationService } from "./services/automationService";
import { BrowserService } from "./services/browserService";
import { ServerConfigService } from "./services/configService";
import { LibraryService } from "./services/libraryService";
import { LibraryWatchService } from "./services/libraryWatchService";
import { MaintenanceService } from "./services/maintenanceService";
import { MediaRootService } from "./services/mediaRootService";
import { ServerPersistenceService } from "./services/persistenceService";
import { RuntimeActionService } from "./services/runtimeActionService";
import { RuntimeLogService } from "./services/runtimeLogService";
import { ScanQueueService } from "./services/scanQueueService";
import { ScrapeService, type ScrapeServiceResources } from "./services/scrapeService";
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
  aggregationService?: ScrapeServiceResources["aggregationService"];
  prepareScrapeItem?: PrepareScrapeItem;
}

export interface BuildServerOptions {
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
  const libraries =
    options.services?.libraries ??
    new MediaLibraryService(
      async () => (await persistence.getState()).repositories.mediaLibraries,
      mediaRoots,
      async () => await config.get(),
    );
  config.onDiagnostic((event) => {
    runtimeLogs
      .getLogger("config")
      .warn(`Configuration ${event.kind} for profile ${event.profileName}: ${event.message}`);
  });
  runtimeLoggerService.setFactory((name) => runtimeLogs.getLogger(name));
  const mappingStore = options.resources?.mappingStore ?? createServerTranslationMappingStore();
  const networkClient =
    options.resources?.networkClient ??
    new NetworkClient({
      getProxyUrl: (site) => resolveSiteProxyUrl(config.getComputed(), site),
      getTimeoutMs: () => config.getComputed().networkTimeoutMs,
      getRetryCount: () => config.getComputed().networkRetryCount,
    });
  const fetchGateway = options.resources?.fetchGateway ?? new FetchGateway(networkClient);
  const crawlerProvider =
    options.resources?.crawlerProvider ??
    new CrawlerProvider({
      fetchGateway,
      siteRequestConfigRegistrar: networkClient,
      getSiteNetworkKey: (site) => siteNetworkKey(config.getComputed(), site),
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
    options.resources?.actorSourceProvider ??
    createServerActorSourceProvider(networkClient, actorImageService, async () =>
      (await libraries.list()).flatMap((library) => [library.sourcePath, library.outputPath].filter(Boolean)),
    );
  const scrape =
    options.services?.scrape ??
    new ScrapeService(persistence, mediaRoots, config, taskEvents, {
      networkClient,
      crawlerProvider,
      imageHostCooldownStore,
      actorImageService,
      actorSourceProvider,
      mappingStore,
      aggregationService: options.resources?.aggregationService,
      prepareScrapeItem: options.resources?.prepareScrapeItem,
    });
  const library = options.services?.library ?? new LibraryService(persistence, mediaRoots, libraries);
  const maintenanceRuntime = createServerMaintenanceRuntime({
    config,
    prepareScrapeItem: options.resources?.prepareScrapeItem,
    networkClient,
    crawlerProvider,
    imageHostCooldownStore,
    actorImageService,
    actorSourceProvider,
    mappingStore,
    recordSiteResults: async (number, results) =>
      (await persistence.getState()).repositories.siteResults.record(number, results),
    loadSiteResults: async (number) => (await persistence.getState()).repositories.siteResults.list(number),
  });
  const maintenance =
    options.services?.maintenance ?? new MaintenanceService(persistence, mediaRoots, taskEvents, maintenanceRuntime);
  const scans = options.services?.scans ?? new ScanQueueService(persistence, mediaRoots, taskEvents, config);
  const system = options.services?.system ?? new SystemService();
  const notePending = (count: number) => {
    automation.notePending(count);
    taskEvents.invalidate("pending");
  };
  const libraryWatch =
    options.services?.libraryWatch ??
    new LibraryWatchService({
      config,
      libraries,
      mediaRoots,
      scrape,
      maintenance,
      persistence,
      logger: runtimeLogs.getLogger("LibraryWatch"),
      onPending: notePending,
    });
  const activity = options.services?.activity ?? new ActivityService({ scans, scrape, maintenance });
  const automation: AutomationService =
    options.services?.automation ??
    new AutomationService({
      activity,
      scrape,
      config,
      libraries,
      libraryWatch,
      mediaRoots,
      persistence,
      taskEvents,
      logger: runtimeLogs.getLogger("Automation"),
    });
  scrape.onPending = (count) => automation.notePending(count);
  const pending =
    options.services?.pending ??
    new PendingService({
      repositories: async () => (await persistence.getState()).repositories,
      mediaRoots,
      startScrape: async (input) => ({ taskId: (await scrape.start(input)).task.id }),
      getConfiguration: async () => await config.get(),
      updateConfiguration: async (patch) => await config.update(patch),
      maintenanceRuntime,
      onChanged: () => taskEvents.invalidate("pending", "scrape-history"),
    });
  const services: ServerServices = {
    activity,
    automation,
    auth: options.services?.auth ?? new AuthService(config.runtimePaths, persistence),
    browser: options.services?.browser ?? new BrowserService(mediaRoots),
    config,
    libraries,
    libraryWatch,
    library,
    maintenance,
    mediaRoots,
    persistence,
    runtimeLogs,
    runtimeActions:
      options.services?.runtimeActions ?? new RuntimeActionService(config, networkClient, crawlerProvider),
    pending,
    scans,
    scrape,
    serverPaths: options.services?.serverPaths ?? new ServerPathService(mediaRoots, config, libraries),
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
  // Plain HTTP routes (automation callbacks, asset and event streams) throw AuthenticationError; a rejected
  // credential is 401, not the 500 a bare Error would produce. tRPC formats its own errors.
  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof AuthenticationError) {
      return reply.code(401).send({ statusCode: 401, error: "Unauthorized", message: error.message });
    }
    reply.send(error);
  });
  const shutdownController = new AbortController();

  fastify.addHook("onReady", async () => {
    await services.persistence.initialize();
    await services.config.load();
    // Settings that moved into libraries become the first library before the configuration is saved without them.
    const legacy = services.config.takeLegacyConversion();
    if (legacy) {
      await services.libraries.adoptLegacyConfiguration(legacy);
      await services.config.save(await services.config.get());
    }
    await services.scans.recoverInterrupted();
    await services.auth.status();
    await services.libraryWatch.start();
    services.automation.start();
  });

  fastify.addHook("preClose", async () => {
    shutdownController.abort();
  });

  let closed = false;
  fastify.addHook("onClose", async () => {
    if (closed) return;
    closed = true;
    services.automation.close();
    const results = await Promise.allSettled([services.libraryWatch.close()]);
    results.push(
      ...(await Promise.allSettled([services.scans.close(), services.scrape.close(), services.maintenance.close()])),
    );
    results.push(...(await Promise.allSettled([imageHostCooldownStore.flush()])));
    results.push(...(await Promise.allSettled([services.persistence.close()])));
    const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
    if (errors.length) throw new AggregateError(errors, "Server shutdown failed");
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
  fastify.get("/ready", async (_request, reply) => {
    if (shutdownController.signal.aborted || !services.persistence.initialized) {
      return reply.code(503).send({ status: "unavailable" });
    }
    try {
      const { database } = await services.persistence.getState();
      database.sqlite.prepare("SELECT count(*) FROM media_roots").get();
      return { status: "ready" };
    } catch (error) {
      runtimeLogs.getLogger("readiness").error(String(error));
      return reply.code(503).send({ status: "unavailable" });
    }
  });

  fastify.get("/api/automation/library/recent", async (request) => {
    await services.auth.assertAutomation(getBearerToken(request));
    const input = automationRecentInputSchema.parse(request.query);
    return await services.automation.recent(input);
  });

  fastify.get("/api/automation/webhooks/status", async (request) => {
    await services.auth.assertAutomation(getBearerToken(request));
    return await services.automation.deliveryStatus();
  });

  fastify.post("/api/automation/scrape/start", async (request) => {
    await services.auth.assertAutomation(getBearerToken(request));
    // Downloaders pass the path as a query parameter (see the qBittorrent command); scripts may send JSON.
    const input = automationScrapeStartInputSchema.parse({
      ...(request.query as object),
      ...(request.body && typeof request.body === "object" ? request.body : {}),
    });
    return await services.automation.scrapeStart(input);
  });

  // CloudDrive2's file system watcher. Answered at once, so scanning a FUSE subtree never stalls CloudDrive.
  fastify.post("/api/webhooks/clouddrive", async (request, reply) => {
    await services.auth.assertAutomation(getBearerToken(request));
    services.libraryWatch.submitCloudDriveChanges(cloudDriveNotifySchema.parse(request.body).data);
    return reply.code(204).send();
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
    await services.auth.assertAuthenticated(getBearerToken(request));
    reply.hijack();
    await writeTaskEventsStream(
      services,
      reply.raw,
      request.headers.origin,
      request.headers.host,
      shutdownController.signal,
    );
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

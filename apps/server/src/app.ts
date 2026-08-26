import { existsSync } from "node:fs";
import path from "node:path";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
import { automationRecentInputSchema, automationScrapeStartInputSchema } from "@mdcz/shared/serverDtos";
import { type CreateFastifyContextOptions, fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyInstance } from "fastify";
import { getBearerToken } from "./http/auth";
import { applyCorsHeaders } from "./http/cors";
import { createHealthPayload } from "./http/health";
import { registerLibraryAssets } from "./http/libraryAssets";
import { writeTaskEventsStream } from "./http/sse";
import { defaultWebStaticDir, registerStaticWeb } from "./http/staticWeb";
import { appRouter } from "./router";
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

export interface BuildServerOptions {
  serviceOptions?: ServerServiceOptions;
  services?: Partial<ServerServices>;
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
  config.onDiagnostic((event) => {
    runtimeLogs
      .getLogger("config")
      .warn(`Configuration ${event.kind} for profile ${event.profileName}: ${event.message}`);
  });
  runtimeLoggerService.setFactory((name) => runtimeLogs.getLogger(name));
  const mappingStore = createServerTranslationMappingStore(config);
  const scrape =
    options.services?.scrape ?? new ScrapeService(persistence, mediaRoots, config, taskEvents, undefined, mappingStore);
  const library = options.services?.library ?? new LibraryService(persistence, mediaRoots);
  const maintenance =
    options.services?.maintenance ??
    new MaintenanceService(persistence, mediaRoots, config, taskEvents, undefined, mappingStore);
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
    runtimeActions: options.services?.runtimeActions ?? new RuntimeActionService(config),
    scans,
    scrape,
    serverPaths: options.services?.serverPaths ?? new ServerPathService(mediaRoots, config),
    system,
    taskEvents,
    tools: options.services?.tools ?? new ToolsService(config, mediaRoots, scrape),
  };
  const fastify = Fastify({
    logger: false,
  });

  fastify.addHook("onReady", async () => {
    await services.config.load();
    await services.config.startWatching();
    await services.persistence.initialize();
    await services.scans.resumeQueued();
    await services.scrape.resumeQueued();
    await services.maintenance.resumeQueued();
  });

  fastify.addHook("onClose", async () => {
    await services.config.stopWatching();
    await services.scrape.close();
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

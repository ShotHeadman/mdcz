import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
import { automationRecentInputSchema, automationScrapeStartInputSchema } from "@mdcz/shared/serverDtos";
import { type CreateFastifyContextOptions, fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { AuthService } from "./authService";
import { AutomationService } from "./automationService";
import { BrowserService } from "./browserService";
import { ServerConfigService } from "./configService";
import { DiagnosticsService } from "./diagnosticsService";
import { createHealthPayload } from "./http";
import { LibraryService } from "./libraryService";
import { MaintenanceService } from "./maintenanceService";
import { MediaRootService } from "./mediaRootService";
import { ServerPersistenceService } from "./persistenceService";
import { appRouter } from "./router";
import { RuntimeLogService } from "./runtimeLogService";
import { ScanQueueService } from "./scanQueueService";
import { ScrapeService } from "./scrapeService";
import type { ServerServiceOptions, ServerServices } from "./services";
import { SystemService } from "./systemService";
import { createTaskEventBus, formatSseEvent } from "./taskEvents";
import { ToolsService } from "./toolsService";

export interface BuildServerOptions {
  serviceOptions?: ServerServiceOptions;
  services?: Partial<ServerServices>;
  webStaticDir?: string | false;
}

const getBearerToken = (request: FastifyRequest): string | undefined => {
  const authorization = request.headers.authorization;
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  const query = request.query as { token?: string } | undefined;
  return query?.token;
};

const allowedCorsOrigins = new Set([
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
]);

const applyCorsHeaders = (request: FastifyRequest, reply: FastifyReply): void => {
  const origin = request.headers.origin;
  if (!origin || !allowedCorsOrigins.has(origin)) {
    return;
  }

  reply.header("access-control-allow-origin", origin);
  reply.header("vary", "Origin");
  reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
  reply.header("access-control-allow-headers", "content-type,authorization");
};

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp",
};

const defaultWebStaticDir = (): string => path.resolve(process.env.MDCZ_WEB_DIST_DIR ?? "dist/web");

const isPathInside = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const isReadableFile = (candidate: string): boolean => {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
};

const registerStaticWeb = (fastify: FastifyInstance, webStaticDir: string): void => {
  const staticRoot = path.resolve(webStaticDir);
  fastify.get("/*", async (request, reply) => {
    const rawPath = request.url.split("?")[0] ?? "/";
    const decodedPath = decodeURIComponent(rawPath);
    const candidate = path.resolve(staticRoot, decodedPath.replace(/^\/+/u, ""));
    const filePath =
      isPathInside(staticRoot, candidate) && isReadableFile(candidate)
        ? candidate
        : path.join(staticRoot, "index.html");
    const extension = path.extname(filePath);
    reply.type(contentTypes[extension] ?? "application/octet-stream");
    return await readFile(filePath);
  });
};

export interface ServerApp {
  fastify: FastifyInstance;
  services: ServerServices;
}

export const buildServer = (options: BuildServerOptions = {}): ServerApp => {
  const config = options.services?.config ?? new ServerConfigService();
  const persistence = options.services?.persistence ?? new ServerPersistenceService(config.runtimePaths);
  const taskEvents = options.services?.taskEvents ?? createTaskEventBus();
  const mediaRoots = options.services?.mediaRoots ?? new MediaRootService(persistence);
  const runtimeLogs = options.services?.runtimeLogs ?? new RuntimeLogService();
  runtimeLoggerService.setFactory((name) => runtimeLogs.getLogger(name));
  const diagnostics = options.services?.diagnostics ?? new DiagnosticsService(persistence, mediaRoots, config);
  const scrape = options.services?.scrape ?? new ScrapeService(persistence, mediaRoots, config, taskEvents);
  const library = options.services?.library ?? new LibraryService(persistence, mediaRoots);
  const maintenance =
    options.services?.maintenance ?? new MaintenanceService(persistence, mediaRoots, config, taskEvents);
  const scans = options.services?.scans ?? new ScanQueueService(persistence, mediaRoots, taskEvents);
  const system = options.services?.system ?? new SystemService();
  const services: ServerServices = {
    automation:
      options.services?.automation ??
      new AutomationService(scans, scrape, maintenance, taskEvents, options.serviceOptions?.automationWebhook),
    auth: options.services?.auth ?? new AuthService(config.runtimePaths),
    browser: options.services?.browser ?? new BrowserService(mediaRoots),
    config,
    diagnostics,
    library,
    maintenance,
    mediaRoots,
    persistence,
    runtimeLogs,
    scans,
    scrape,
    system,
    taskEvents,
    tools: options.services?.tools ?? new ToolsService(config, mediaRoots, scrape, diagnostics, library),
  };
  const fastify = Fastify({
    logger: false,
  });

  fastify.addHook("onReady", async () => {
    await services.config.load();
    await services.persistence.initialize();
    await services.scans.resumeQueued();
    await services.scrape.resumeQueued();
    await services.maintenance.resumeQueued();
  });

  fastify.addHook("onClose", async () => {
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
    reply.raw.writeHead(200, {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    });
    reply.raw.write(": connected\n\n");

    const heartbeatInterval = setInterval(() => {
      reply.raw.write(": heartbeat\n\n");
    }, 30_000);
    const unsubscribe = services.taskEvents.subscribe((event) => {
      reply.raw.write(formatSseEvent(event));
    });
    const [scanSnapshot, scrapeSnapshot, maintenanceSnapshot] = await Promise.all([
      services.scans.list(),
      services.scrape.list(),
      services.maintenance.list(),
    ]);
    reply.raw.write(
      formatSseEvent({
        id: "snapshot",
        event: "task-update",
        data: {
          kind: "snapshot",
          tasks: [...scanSnapshot.tasks, ...scrapeSnapshot.tasks, ...maintenanceSnapshot.tasks],
        },
      }),
    );

    request.raw.on("close", () => {
      clearInterval(heartbeatInterval);
      unsubscribe();
    });
  });

  if (hasStaticWeb && webStaticDir) {
    registerStaticWeb(fastify, webStaticDir);
  }

  return {
    fastify,
    services,
  };
};

import { type CreateFastifyContextOptions, fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";

import { AuthService } from "./authService";
import { BrowserService } from "./browserService";
import { ServerConfigService } from "./configService";
import { DiagnosticsService } from "./diagnosticsService";
import { createHealthPayload } from "./http";
import { LibraryService } from "./libraryService";
import { MediaRootService } from "./mediaRootService";
import { ServerPersistenceService } from "./persistenceService";
import { appRouter } from "./router";
import { ScanQueueService } from "./scanQueueService";
import { ScrapeService } from "./scrapeService";
import type { ServerServices } from "./services";
import { createTaskEventBus, formatSseEvent } from "./taskEvents";

export interface BuildServerOptions {
  services?: Partial<ServerServices>;
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

export interface ServerApp {
  fastify: FastifyInstance;
  services: ServerServices;
}

export const buildServer = (options: BuildServerOptions = {}): ServerApp => {
  const config = options.services?.config ?? new ServerConfigService();
  const persistence = options.services?.persistence ?? new ServerPersistenceService(config.runtimePaths);
  const taskEvents = options.services?.taskEvents ?? createTaskEventBus();
  const mediaRoots = options.services?.mediaRoots ?? new MediaRootService(persistence);
  const services: ServerServices = {
    auth: options.services?.auth ?? new AuthService(config.runtimePaths),
    browser: options.services?.browser ?? new BrowserService(mediaRoots),
    config,
    diagnostics: options.services?.diagnostics ?? new DiagnosticsService(persistence, mediaRoots),
    library: options.services?.library ?? new LibraryService(persistence, mediaRoots),
    mediaRoots,
    persistence,
    scans: options.services?.scans ?? new ScanQueueService(persistence, mediaRoots, taskEvents),
    scrape: options.services?.scrape ?? new ScrapeService(persistence, mediaRoots, config, taskEvents),
    taskEvents,
  };
  const fastify = Fastify({
    logger: false,
  });

  fastify.addHook("onReady", async () => {
    await services.config.load();
    await services.persistence.initialize();
    await services.scans.resumeQueued();
    await services.scrape.resumeQueued();
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

  fastify.get("/", async () => createHealthPayload());
  fastify.get("/health", async () => createHealthPayload());

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
    const [scanSnapshot, scrapeSnapshot] = await Promise.all([services.scans.list(), services.scrape.list()]);
    reply.raw.write(
      formatSseEvent({
        id: "snapshot",
        event: "task-update",
        data: { kind: "snapshot", tasks: [...scanSnapshot.tasks, ...scrapeSnapshot.tasks] },
      }),
    );

    request.raw.on("close", () => {
      clearInterval(heartbeatInterval);
      unsubscribe();
    });
  });

  return {
    fastify,
    services,
  };
};

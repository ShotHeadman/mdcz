import { type CreateFastifyContextOptions, fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import { AuthService } from "./authService";
import { BrowserService } from "./browserService";
import { ServerConfigService } from "./configService";
import { createHealthPayload } from "./http";
import { MediaRootService } from "./mediaRootService";
import { ServerPersistenceService } from "./persistenceService";
import { appRouter } from "./router";
import { ScanQueueService } from "./scanQueueService";
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
    auth: options.services?.auth ?? new AuthService(),
    browser: options.services?.browser ?? new BrowserService(mediaRoots),
    config,
    mediaRoots,
    persistence,
    scans: options.services?.scans ?? new ScanQueueService(persistence, mediaRoots, taskEvents),
    taskEvents,
  };
  const fastify = Fastify({
    logger: false,
  });

  fastify.addHook("onReady", async () => {
    await services.config.load();
    await services.persistence.initialize();
    await services.scans.resumeQueued();
  });

  fastify.addHook("onClose", async () => {
    await services.persistence.close();
  });

  fastify.get("/", async () => createHealthPayload());
  fastify.get("/health", async () => createHealthPayload());

  fastify.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
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
    const snapshot = await services.scans.list();
    reply.raw.write(
      formatSseEvent({ id: "snapshot", event: "task-update", data: { kind: "snapshot", tasks: snapshot.tasks } }),
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

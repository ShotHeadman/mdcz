import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyInstance } from "fastify";

import { ServerConfigService } from "./configService";
import { createHealthPayload } from "./http";
import { ServerPersistenceService } from "./persistenceService";
import { appRouter } from "./router";
import type { ServerServices } from "./services";
import { createTaskEventBus, formatSseEvent } from "./taskEvents";

export interface BuildServerOptions {
  services?: Partial<ServerServices>;
}

export interface ServerApp {
  fastify: FastifyInstance;
  services: ServerServices;
}

export const buildServer = (options: BuildServerOptions = {}): ServerApp => {
  const config = options.services?.config ?? new ServerConfigService();
  const services: ServerServices = {
    config,
    persistence: options.services?.persistence ?? new ServerPersistenceService(config.runtimePaths),
    taskEvents: options.services?.taskEvents ?? createTaskEventBus(),
  };
  const fastify = Fastify({
    logger: false,
  });

  fastify.addHook("onReady", async () => {
    await services.config.load();
    await services.persistence.initialize();
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
      createContext: () => ({ services }),
    },
  });

  fastify.get("/events/tasks", (request, reply) => {
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

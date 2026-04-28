import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyInstance } from "fastify";

import { createHealthPayload } from "./http";
import { appRouter } from "./router";
import { createTaskEventBus, formatSseEvent, type TaskEventBus } from "./taskEvents";

export interface ServerServices {
  taskEvents: TaskEventBus;
}

export interface BuildServerOptions {
  services?: Partial<ServerServices>;
}

export interface ServerApp {
  fastify: FastifyInstance;
  services: ServerServices;
}

export const buildServer = (options: BuildServerOptions = {}): ServerApp => {
  const services: ServerServices = {
    taskEvents: options.services?.taskEvents ?? createTaskEventBus(),
  };
  const fastify = Fastify({
    logger: false,
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

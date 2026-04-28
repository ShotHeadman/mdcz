import { afterEach, describe, expect, it } from "vitest";

import { buildServer, type ServerApp } from "./app";
import { formatSseEvent } from "./taskEvents";

const textDecoder = new TextDecoder();

const readStreamChunk = async (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> => {
  const chunk = await reader.read();

  if (chunk.done) {
    throw new Error("Expected SSE stream chunk before stream ended");
  }

  return textDecoder.decode(chunk.value);
};

const expectedHealthPayload = {
  service: "mdcz-server",
  status: "ok",
  slice: "app-skeleton",
} as const;

let serverApp: ServerApp | undefined;

const createTestServer = (): ServerApp => {
  serverApp = buildServer();
  return serverApp;
};

afterEach(async () => {
  await serverApp?.fastify.close();
  serverApp = undefined;
});

describe("buildServer", () => {
  it("preserves the root and health HTTP contracts", async () => {
    const { fastify } = createTestServer();

    const rootResponse = await fastify.inject({ method: "GET", url: "/" });
    const healthResponse = await fastify.inject({ method: "GET", url: "/health" });

    expect(rootResponse.statusCode).toBe(200);
    expect(rootResponse.json()).toEqual(expectedHealthPayload);
    expect(healthResponse.statusCode).toBe(200);
    expect(healthResponse.json()).toEqual(expectedHealthPayload);
  });

  it("mounts a tRPC health procedure", async () => {
    const { fastify } = createTestServer();

    const response = await fastify.inject({ method: "GET", url: "/trpc/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      result: {
        data: expectedHealthPayload,
      },
    });
  });

  it("returns not found for unknown routes", async () => {
    const { fastify } = createTestServer();

    const response = await fastify.inject({ method: "GET", url: "/unknown" });

    expect(response.statusCode).toBe(404);
  });

  it("streams task updates through the SSE endpoint", async () => {
    const { fastify, services } = createTestServer();
    const address = await fastify.listen({ host: "127.0.0.1", port: 0 });
    const abortController = new AbortController();
    const response = await fetch(`${address}/events/tasks`, {
      signal: abortController.signal,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.body).not.toBeNull();

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected SSE response body reader");
    }

    expect(await readStreamChunk(reader)).toBe(": connected\n\n");
    expect(services.taskEvents.listenerCount()).toBe(1);

    const event = services.taskEvents.publish({
      taskId: "task-1",
      status: "running",
      emittedAt: "2026-04-28T00:00:00.000Z",
    });

    expect(await readStreamChunk(reader)).toBe(formatSseEvent(event));

    await reader.cancel();
    abortController.abort();

    await expect.poll(() => services.taskEvents.listenerCount()).toBe(0);
  });
});

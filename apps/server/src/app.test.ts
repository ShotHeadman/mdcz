import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfiguration } from "@mdcz/shared/config";
import { afterEach, describe, expect, it } from "vitest";

import { buildServer, type ServerApp } from "./app";
import { ServerConfigService } from "./configService";
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

const createTestServer = async (): Promise<ServerApp> => {
  const root = await mkdtemp(join(tmpdir(), "mdcz-server-app-"));
  const paths = {
    configDir: join(root, "config"),
    dataDir: join(root, "data"),
    configPath: join(root, "config", "default.toml"),
    databasePath: join(root, "data", "mdcz.sqlite"),
  };
  serverApp = buildServer({ services: { config: new ServerConfigService(paths) } });
  return serverApp;
};

afterEach(async () => {
  await serverApp?.fastify.close();
  serverApp = undefined;
});

describe("buildServer", () => {
  it("preserves the root and health HTTP contracts", async () => {
    const { fastify } = await createTestServer();

    const rootResponse = await fastify.inject({ method: "GET", url: "/" });
    const healthResponse = await fastify.inject({ method: "GET", url: "/health" });

    expect(rootResponse.statusCode).toBe(200);
    expect(rootResponse.json()).toEqual(expectedHealthPayload);
    expect(healthResponse.statusCode).toBe(200);
    expect(healthResponse.json()).toEqual(expectedHealthPayload);
  });

  it("mounts a tRPC health procedure", async () => {
    const { fastify } = await createTestServer();

    const response = await fastify.inject({ method: "GET", url: "/trpc/health.read" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      result: {
        data: expectedHealthPayload,
      },
    });
  });

  it("allows WebUI dev origins to preflight tRPC requests", async () => {
    const { fastify } = await createTestServer();

    const response = await fastify.inject({
      method: "OPTIONS",
      url: "/trpc/auth.login",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-headers": "content-type,authorization",
        "access-control-request-method": "POST",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
    expect(response.headers["access-control-allow-headers"]).toContain("authorization");
  });

  it("exposes auth setup state before login", async () => {
    const { fastify } = await createTestServer();

    const response = await fastify.inject({ method: "GET", url: "/trpc/auth.setup" });

    expect(response.statusCode).toBe(200);
    expect(response.json().result.data).toEqual({
      authenticated: false,
      setupRequired: true,
      usingDefaultPassword: true,
    });
  });

  it("completes first-run setup without a prior session and persists completion", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-setup-root-"));
    const { fastify, services } = await createTestServer();

    const completeResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/setup.complete",
      payload: { password: "changed-password", mediaRoot: { displayName: "Media", hostPath: root, enabled: true } },
    });
    const statusResponse = await fastify.inject({ method: "GET", url: "/trpc/setup.status" });
    const repeatResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/setup.complete",
      payload: { password: "another-password", mediaRoot: { displayName: "Media 2", hostPath: root, enabled: true } },
    });
    const state = JSON.parse(await readFile(join(services.config.runtimePaths.configDir, "auth-state.json"), "utf8"));

    expect(completeResponse.statusCode).toBe(200);
    expect(completeResponse.json().result.data).toMatchObject({ authenticated: true });
    expect(completeResponse.json().result.data.token).toEqual(expect.any(String));
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json().result.data).toMatchObject({
      configured: true,
      setupRequired: false,
      mediaRootCount: 1,
      usingDefaultPassword: false,
    });
    expect(state).toEqual({ setupCompleted: true, adminPassword: "changed-password" });
    expect(repeatResponse.statusCode).toBe(403);
  });

  it("rejects completing setup with the default admin password", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-default-setup-root-"));
    const { fastify } = await createTestServer();

    const response = await fastify.inject({
      method: "POST",
      url: "/trpc/setup.complete",
      payload: { password: "admin", mediaRoot: { displayName: "Media", hostPath: root, enabled: true } },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.message).toContain("不能使用默认管理员密码");
  });

  it("mounts tRPC config read and export procedures", async () => {
    const { fastify, services } = await createTestServer();
    await services.config.save(defaultConfiguration);

    const loginResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "admin" },
    });
    const token = loginResponse.json().result.data.token;
    const readResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/config.read",
      headers: { authorization: `Bearer ${token}` },
    });
    const exportResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/config.export",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(readResponse.statusCode).toBe(200);
    expect(readResponse.json().result.data.network.timeout).toBe(defaultConfiguration.network.timeout);
    expect(exportResponse.statusCode).toBe(200);
    expect(exportResponse.json().result.data).toContain("[network]");
  });

  it("initializes SQLite migrations before serving tRPC persistence status", async () => {
    const { fastify, services } = await createTestServer();

    const loginResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "admin" },
    });
    const token = loginResponse.json().result.data.token;
    const response = await fastify.inject({
      method: "GET",
      url: "/trpc/persistence.status",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      result: {
        data: {
          ok: true,
          path: services.persistence.databasePath,
        },
      },
    });
  });

  it("updates TOML-backed config through tRPC", async () => {
    const { fastify } = await createTestServer();
    const loginResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "admin" },
    });
    const token = loginResponse.json().result.data.token;

    const defaultsResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/config.defaults",
      headers: { authorization: `Bearer ${token}` },
    });
    const response = await fastify.inject({
      method: "POST",
      url: "/trpc/config.update",
      headers: { authorization: `Bearer ${token}` },
      payload: { network: { timeout: 25 }, scrape: { threadNumber: 4 } },
    });
    const resetResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/config.reset",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    const importResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/config.import",
      headers: { authorization: `Bearer ${token}` },
      payload: { content: "[network]\ntimeout = 33\n" },
    });

    expect(defaultsResponse.statusCode).toBe(200);
    expect(response.statusCode).toBe(200);
    expect(response.json().result.data.network.timeout).toBe(25);
    expect(response.json().result.data.scrape.threadNumber).toBe(4);
    expect(resetResponse.statusCode).toBe(200);
    expect(resetResponse.json().result.data.network.timeout).toBe(defaultsResponse.json().result.data.network.timeout);
    expect(importResponse.statusCode).toBe(200);
    expect(importResponse.json().result.data.network.timeout).toBe(33);
  });

  it("manages media roots and rejects native remote URLs through tRPC", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-media-root-"));
    const { fastify } = await createTestServer();
    const loginResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "admin" },
    });
    const token = loginResponse.json().result.data.token;

    const createResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/mediaRoots.create",
      headers: { authorization: `Bearer ${token}` },
      payload: { displayName: "Media", hostPath: root, enabled: true },
    });
    const created = createResponse.json().result.data;
    const availabilityResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/mediaRoots.availability?input=${encodeURIComponent(JSON.stringify({ id: created.id }))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const diagnosticsResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/diagnostics.summary",
      headers: { authorization: `Bearer ${token}` },
    });
    const renamedRoot = await mkdtemp(join(tmpdir(), "mdcz-media-root-renamed-"));
    const updateResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/mediaRoots.update",
      headers: { authorization: `Bearer ${token}` },
      payload: { id: created.id, displayName: "Renamed", hostPath: renamedRoot },
    });
    const remoteResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/mediaRoots.create",
      headers: { authorization: `Bearer ${token}` },
      payload: { displayName: "Remote", hostPath: "webdav://nas/media", enabled: true },
    });

    expect(createResponse.statusCode).toBe(200);
    expect(created.hostPath).toBe(root);
    expect(created.displayName).toBe("Media");
    expect(created.rootType).toBe("mounted-filesystem");
    expect(availabilityResponse.statusCode).toBe(200);
    expect(availabilityResponse.json().result.data.availability.available).toBe(true);
    expect(diagnosticsResponse.statusCode).toBe(200);
    expect(diagnosticsResponse.json().result.data.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: `media-root:${created.id}`, ok: true })]),
    );
    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json().result.data.displayName).toBe("Renamed");
    expect(updateResponse.json().result.data.hostPath).toBe(renamedRoot);
    expect(remoteResponse.statusCode).toBe(500);
    expect(remoteResponse.json().error.message).toContain("暂不支持原生远程协议 URL");
  });

  it("rejects root browser escape attempts", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-browser-root-"));
    const { fastify } = await createTestServer();
    const loginResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "admin" },
    });
    const token = loginResponse.json().result.data.token;
    const createResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/mediaRoots.create",
      headers: { authorization: `Bearer ${token}` },
      payload: { displayName: "Media", hostPath: root, enabled: true },
    });
    const rootId = createResponse.json().result.data.id;

    const response = await fastify.inject({
      method: "GET",
      url: `/trpc/browser.list?input=${encodeURIComponent(JSON.stringify({ rootId, relativePath: ".." }))}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.message).toContain("escapes media root");
  });

  it("scans mounted media roots and serves persisted task details", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-scan-root-"));
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "nested", "movie.mp4"), "video");
    await writeFile(join(root, "nested", "notes.txt"), "text");
    const { fastify } = await createTestServer();
    const loginResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "admin" },
    });
    const token = loginResponse.json().result.data.token;
    const createResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/mediaRoots.create",
      headers: { authorization: `Bearer ${token}` },
      payload: { displayName: "Media", hostPath: root, enabled: true },
    });
    const rootId = createResponse.json().result.data.id;

    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scans.start",
      headers: { authorization: `Bearer ${token}` },
      payload: { rootId },
    });
    const taskId = startResponse.json().result.data.id;

    await expect
      .poll(async () => {
        const detailResponse = await fastify.inject({
          method: "GET",
          url: `/trpc/scans.detail?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
          headers: { authorization: `Bearer ${token}` },
        });
        return detailResponse.json().result.data.task.status;
      })
      .toBe("completed");

    const detailResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/tasks.detail?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const listResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/tasks.list",
      headers: { authorization: `Bearer ${token}` },
    });
    const libraryResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/library.list",
      headers: { authorization: `Bearer ${token}` },
      payload: { query: "movie", limit: 20 },
    });

    const overviewResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/overview.summary",
      headers: { authorization: `Bearer ${token}` },
    });
    const logsResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/logs.list",
      headers: { authorization: `Bearer ${token}` },
    });

    const retryResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/tasks.retry",
      headers: { authorization: `Bearer ${token}` },
      payload: { taskId },
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().result.data.tasks[0]).toMatchObject({
      id: taskId,
      kind: "scan",
      rootDisplayName: "Media",
    });
    expect(detailResponse.json().result.data.task.videoCount).toBe(1);
    expect(detailResponse.json().result.data.task.kind).toBe("scan");
    expect(detailResponse.json().result.data.task.rootDisplayName).toBe("Media");
    expect(detailResponse.json().result.data.task.videos).toEqual(["nested/movie.mp4"]);
    expect(libraryResponse.statusCode).toBe(200);
    expect(libraryResponse.json().result.data).toEqual({ entries: [], total: 0 });
    expect(overviewResponse.statusCode).toBe(200);
    expect(overviewResponse.json().result.data.output).toMatchObject({ fileCount: 0, totalBytes: 0 });
    expect(overviewResponse.json().result.data.recentAcquisitions).toEqual([]);
    expect(detailResponse.json().result.data.events.map((event: { type: string }) => event.type)).toContain(
      "completed",
    );
    expect(logsResponse.statusCode).toBe(200);
    expect(logsResponse.json().result.data.logs[0]).toMatchObject({ source: "task", type: "completed" });
    expect(retryResponse.statusCode).toBe(200);
    expect(retryResponse.json().result.data.status).toBe("queued");

    await expect
      .poll(async () => {
        const retriedDetailResponse = await fastify.inject({
          method: "GET",
          url: `/trpc/scans.detail?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
          headers: { authorization: `Bearer ${token}` },
        });
        return retriedDetailResponse.json().result.data.task.status;
      })
      .toBe("completed");

    const retriedLibraryResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/library.list",
      headers: { authorization: `Bearer ${token}` },
      payload: { query: "movie", limit: 20 },
    });
    expect(retriedLibraryResponse.json().result.data.total).toBe(0);
  });

  it("closes the persistence database with the Fastify lifecycle", async () => {
    const { fastify, services } = await createTestServer();

    await fastify.ready();
    expect(services.persistence.initialized).toBe(true);

    await fastify.close();
    expect(services.persistence.initialized).toBe(false);
    serverApp = undefined;
  });

  it("returns not found for unknown routes", async () => {
    const { fastify } = await createTestServer();

    const response = await fastify.inject({ method: "GET", url: "/unknown" });

    expect(response.statusCode).toBe(404);
  });

  it("streams task updates through the SSE endpoint", async () => {
    const { fastify, services } = await createTestServer();
    const loginResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "admin" },
    });
    const token = loginResponse.json().result.data.token;
    const address = await fastify.listen({ host: "127.0.0.1", port: 0 });
    const abortController = new AbortController();
    const response = await fetch(`${address}/events/tasks?token=${encodeURIComponent(token)}`, {
      signal: abortController.signal,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.body).not.toBeNull();

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected SSE response body reader");
    }

    const initialChunk = await readStreamChunk(reader);
    expect(initialChunk).toContain(": connected\n\n");
    expect(initialChunk).toContain('data: {"kind":"snapshot","tasks":[]}');
    expect(services.taskEvents.listenerCount()).toBe(1);

    const event = services.taskEvents.publish({
      kind: "task",
      task: {
        id: "task-1",
        kind: "scan",
        rootId: "root-1",
        rootDisplayName: "Media",
        status: "running",
        createdAt: "2026-04-28T00:00:00.000Z",
        updatedAt: "2026-04-28T00:00:00.000Z",
        startedAt: "2026-04-28T00:00:00.000Z",
        completedAt: null,
        videoCount: 0,
        directoryCount: 0,
        error: null,
        videos: [],
      },
    });

    expect(await readStreamChunk(reader)).toBe(formatSseEvent(event));

    await reader.cancel();
    abortController.abort();

    await expect.poll(() => services.taskEvents.listenerCount()).toBe(0);
  });
});

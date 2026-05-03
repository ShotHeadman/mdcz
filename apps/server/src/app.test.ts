import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AggregationResult,
  type ManualScrapeOptions,
  type MountedRootScrapeAggregationService,
  MountedRootScrapeRuntime,
  NfoGenerator,
} from "@mdcz/runtime/scrape";
import { type Configuration, defaultConfiguration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer, type ServerApp } from "./app";
import { ServerConfigService } from "./configService";
import { MediaRootService } from "./mediaRootService";
import { ServerPersistenceService } from "./persistenceService";
import { ScrapeService } from "./scrapeService";
import { createTaskEventBus, formatSseEvent } from "./taskEvents";

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

interface TestServerOptions {
  automationWebhook?: {
    secret?: string;
    url?: string;
  };
  scrapeAggregation?: MountedRootScrapeAggregationService;
}

const createTestServer = async (options: TestServerOptions = {}): Promise<ServerApp> => {
  const root = await mkdtemp(join(tmpdir(), "mdcz-server-app-"));
  const paths = {
    configDir: join(root, "config"),
    dataDir: join(root, "data"),
    configPath: join(root, "config", "default.toml"),
    databasePath: join(root, "data", "mdcz.sqlite"),
  };
  const config = new ServerConfigService(paths);
  const persistence = new ServerPersistenceService(paths);
  const mediaRoots = new MediaRootService(persistence);
  const taskEvents = createTaskEventBus();
  serverApp = buildServer({
    serviceOptions: {
      automationWebhook: options.automationWebhook,
    },
    webStaticDir: false,
    services: {
      config,
      mediaRoots,
      persistence,
      taskEvents,
      scrape: options.scrapeAggregation
        ? new ScrapeService(
            persistence,
            mediaRoots,
            config,
            taskEvents,
            new MountedRootScrapeRuntime(config, options.scrapeAggregation),
          )
        : undefined,
    },
  });
  return serverApp;
};

const startWebhookServer = async (): Promise<{
  close: () => Promise<void>;
  deliveries: Array<{ body: unknown; secret?: string }>;
  url: string;
}> => {
  const deliveries: Array<{ body: unknown; secret?: string }> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      deliveries.push({
        body: raw ? JSON.parse(raw) : null,
        secret: request.headers["x-mdcz-webhook-secret"]?.toString(),
      });
      response.writeHead(204);
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected webhook test server address");
  }
  return {
    deliveries,
    url: `http://127.0.0.1:${address.port}/webhook`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
};

const createPngBytes = (): Buffer => {
  const header = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00,
  ]);
  return Buffer.concat([header, Buffer.alloc(9000)]);
};

const startImageServer = async (): Promise<{ url: string; close: () => Promise<void> }> => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "image/png" });
    response.end(createPngBytes());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected HTTP test server address");
  }
  return {
    url: `http://127.0.0.1:${address.port}/image.png`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
};

const createFakeAggregation = (imageUrl: string, actorPhotoPath?: string): MountedRootScrapeAggregationService => ({
  async aggregate(
    number: string,
    _configuration: Configuration,
    _signal?: AbortSignal,
    manualScrape?: ManualScrapeOptions,
  ): Promise<AggregationResult> {
    return {
      data: {
        title: `Runtime Title ${number}`,
        title_zh: `运行时标题 ${number}`,
        number,
        actors: ["Actor A"],
        actor_profiles: actorPhotoPath ? [{ name: "Actor A", photo_url: actorPhotoPath }] : undefined,
        genres: ["Drama"],
        studio: "Runtime Studio",
        plot: manualScrape?.detailUrl ?? "Runtime plot",
        release_date: "2024-01-15",
        thumb_url: imageUrl,
        poster_url: imageUrl,
        fanart_url: imageUrl,
        scene_images: [],
        website: Website.JAVDB,
      },
      sources: {
        title: Website.JAVDB,
        thumb_url: Website.JAVDB,
        poster_url: Website.JAVDB,
      },
      imageAlternatives: {
        thumb_url: [],
        poster_url: [],
        scene_images: [],
        scene_image_sources: [],
      },
      stats: {
        totalSites: 1,
        successCount: 1,
        failedCount: 0,
        skippedCount: 0,
        siteResults: [{ site: Website.JAVDB, success: true, elapsedMs: 1 }],
        totalElapsedMs: 1,
      },
    };
  },
});

const createAbortAwareAggregation = (): {
  aggregation: MountedRootScrapeAggregationService;
  aborted: Promise<void>;
  started: Promise<void>;
} => {
  let resolveStarted!: () => void;
  let resolveAborted!: () => void;
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  const aborted = new Promise<void>((resolve) => {
    resolveAborted = resolve;
  });

  return {
    started,
    aborted,
    aggregation: {
      async aggregate(_number, _configuration, signal): Promise<AggregationResult | null> {
        resolveStarted();
        return await new Promise<AggregationResult | null>((resolve) => {
          if (signal?.aborted) {
            resolveAborted();
            resolve(null);
            return;
          }
          signal?.addEventListener(
            "abort",
            () => {
              resolveAborted();
              resolve(null);
            },
            { once: true },
          );
        });
      },
    },
  };
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

  it("exposes server and Web build metadata through system.about", async () => {
    const { fastify } = await createTestServer();
    const loginResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "admin" },
    });
    const token = loginResponse.json().result.data.token;

    const response = await fastify.inject({
      method: "GET",
      url: "/trpc/system.about",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result.data).toMatchObject({
      productName: "MDCz",
      community: {
        feedback: { url: "https://github.com/ShotHeadman/mdcz/issues/new/choose" },
      },
      build: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
    });
    expect(response.json().result.data.version).toEqual(expect.any(String));
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

  it("serves runtime logs and executes server-backed tools through tRPC", async () => {
    const { fastify, services } = await createTestServer();
    const loginResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "admin" },
    });
    const token = loginResponse.json().result.data.token;
    services.runtimeLogs.append("test-runtime", "warn", "runtime warning");

    const logsResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/logs.list",
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: "runtime" },
    });
    const catalogResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/tools.catalog",
      headers: { authorization: `Bearer ${token}` },
    });
    const executeResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/tools.execute",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        toolId: "missing-number-finder",
        prefix: "ABC",
        start: 1,
        end: 3,
        existing: ["ABC-001", "ABC-003"],
      },
    });

    expect(logsResponse.statusCode).toBe(200);
    expect(logsResponse.json().result.data.logs[0]).toMatchObject({
      level: "WARN",
      message: "runtime warning",
      source: "runtime",
    });
    expect(catalogResponse.statusCode).toBe(200);
    expect(catalogResponse.json().result.data.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "single-file-scraper" })]),
    );
    expect(executeResponse.statusCode).toBe(200);
    expect(executeResponse.json().result.data).toMatchObject({
      ok: true,
      data: { missing: ["ABC-002"], total: 1 },
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

  it("protects automation REST endpoints and returns durable webhook payloads", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-automation-root-"));
    await writeFile(join(root, "auto.mp4"), "video");
    const { fastify } = await createTestServer();
    const unauthorizedResponse = await fastify.inject({
      method: "GET",
      url: "/api/automation/library/recent",
    });
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
      url: "/api/automation/scrape/start",
      headers: { authorization: `Bearer ${token}` },
      payload: { rootId },
    });
    const taskId = startResponse.json().task.id;

    await expect
      .poll(async () => {
        const detailResponse = await fastify.inject({
          method: "GET",
          url: `/trpc/tasks.detail?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
          headers: { authorization: `Bearer ${token}` },
        });
        return detailResponse.json().result.data.task.status;
      })
      .toBe("completed");

    const recentResponse = await fastify.inject({
      method: "GET",
      url: "/api/automation/library/recent?limit=1",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(unauthorizedResponse.statusCode).toBe(500);
    expect(unauthorizedResponse.json().message).toContain("Authentication required");
    expect(startResponse.statusCode).toBe(200);
    expect(startResponse.json().webhook).toEqual({
      taskId,
      kind: "scan",
      status: "queued",
      startedAt: null,
      completedAt: null,
      summary: "扫描 Media: queued",
      errors: [],
    });
    expect(recentResponse.statusCode).toBe(200);
    expect(recentResponse.json().tasks[0]).toMatchObject({
      taskId,
      kind: "scan",
      status: "completed",
      summary: "扫描 Media: completed",
      errors: [],
    });
    expect(recentResponse.json().tasks[0].completedAt).toEqual(expect.any(String));
  });

  it("delivers outbound automation webhooks when task updates are published", async () => {
    const webhook = await startWebhookServer();
    const root = await mkdtemp(join(tmpdir(), "mdcz-outbound-webhook-root-"));
    await writeFile(join(root, "auto-webhook.mp4"), "video");
    const { fastify } = await createTestServer({
      automationWebhook: {
        secret: "test-secret",
        url: webhook.url,
      },
    });
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
      url: "/api/automation/scrape/start",
      headers: { authorization: `Bearer ${token}` },
      payload: { rootId },
    });
    const taskId = startResponse.json().task.id;

    await expect
      .poll(async () => {
        const detailResponse = await fastify.inject({
          method: "GET",
          url: `/trpc/tasks.detail?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
          headers: { authorization: `Bearer ${token}` },
        });
        return detailResponse.json().result.data.task.status;
      })
      .toBe("completed");

    await expect.poll(() => webhook.deliveries.length).toBeGreaterThanOrEqual(3);
    const statusResponse = await fastify.inject({
      method: "GET",
      url: "/api/automation/webhooks/status",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(webhook.deliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          body: expect.objectContaining({ taskId, kind: "scan", status: "queued" }),
          secret: "test-secret",
        }),
        expect.objectContaining({
          body: expect.objectContaining({ taskId, kind: "scan", status: "completed" }),
          secret: "test-secret",
        }),
      ]),
    );
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json().webhook).toMatchObject({
      configured: true,
      failed: 0,
    });
    expect(statusResponse.json().webhook.delivered).toBeGreaterThanOrEqual(3);

    await webhook.close();
  });

  it("runs the full scrape runtime pipeline and indexes organized output", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-scrape-runtime-root-"));
    const actorRoot = await mkdtemp(join(tmpdir(), "mdcz-actor-root-"));
    const actorPhotoPath = join(actorRoot, "Actor A.jpg");
    await writeFile(join(root, "ABC-123.mp4"), "video");
    await writeFile(actorPhotoPath, createPngBytes());
    const imageServer = await startImageServer();
    const { fastify } = await createTestServer({
      scrapeAggregation: createFakeAggregation(imageServer.url, actorPhotoPath),
    });
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
    await fastify.inject({
      method: "POST",
      url: "/trpc/config.update",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        download: { downloadSceneImages: false },
        paths: { actorPhotoFolder: actorRoot },
      },
    });

    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.start",
      headers: { authorization: `Bearer ${token}` },
      payload: { refs: [{ rootId, relativePath: "ABC-123.mp4" }] },
    });
    const taskId = startResponse.json().result.data.id;

    await expect
      .poll(async () => {
        const detailResponse = await fastify.inject({
          method: "GET",
          url: `/trpc/tasks.detail?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
          headers: { authorization: `Bearer ${token}` },
        });
        return detailResponse.json().result.data.task.status;
      })
      .toBe("completed");

    const libraryResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/library.search",
      headers: { authorization: `Bearer ${token}` },
      payload: { query: "ABC-123", limit: 20 },
    });
    const entry = libraryResponse.json().result.data.entries[0];
    const detailResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/library.detail?input=${encodeURIComponent(JSON.stringify({ id: entry.id }))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const overviewResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/overview.summary",
      headers: { authorization: `Bearer ${token}` },
    });
    const outputRelativePath = "JAV_output/Actor A/ABC-123/ABC-123.mp4";
    const nfoRelativePath = "JAV_output/Actor A/ABC-123/ABC-123.nfo";
    const nfoContent = await readFile(join(root, nfoRelativePath), "utf8");
    const actorPhotoContent = await readFile(join(root, "JAV_output/Actor A/ABC-123/.actors/Actor A.jpg"));
    const thumbContent = await readFile(join(root, "JAV_output/Actor A/ABC-123/thumb.png"));

    expect(libraryResponse.statusCode).toBe(200);
    expect(libraryResponse.json().result.data.total).toBe(1);
    expect(entry).toMatchObject({
      actors: ["Actor A"],
      available: true,
      fileName: "ABC-123.mp4",
      mediaIdentity: "ABC-123",
      number: "ABC-123",
      rootDisplayName: "Media",
    });
    expect(entry.relativePath).toBe(outputRelativePath);
    expect(entry.thumbnailPath).toBe("JAV_output/Actor A/ABC-123/thumb.png");
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json().result.data.entry.crawlerData).toMatchObject({
      number: "ABC-123",
      studio: "Runtime Studio",
      title: "Runtime Title ABC-123",
      website: "javdb",
    });
    expect(detailResponse.json().result.data.entry.fileRefs[0]).toMatchObject({
      relativePath: outputRelativePath,
      available: true,
    });
    expect(detailResponse.json().result.data.entry.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "thumb", uri: "JAV_output/Actor A/ABC-123/thumb.png" }),
        expect.objectContaining({ kind: "poster", uri: "JAV_output/Actor A/ABC-123/poster.png" }),
      ]),
    );
    expect(nfoContent).toContain("Runtime Title ABC-123");
    expect(nfoContent).toContain(".actors/Actor A.jpg");
    expect(actorPhotoContent.length).toBeGreaterThan(8000);
    expect(thumbContent.length).toBeGreaterThan(8000);
    expect(overviewResponse.json().result.data.recentAcquisitions[0]).toMatchObject({
      id: entry.id,
      number: "ABC-123",
      available: true,
    });
    await imageServer.close();
  });

  it("aborts an active scrape runtime pipeline when the task is stopped", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-scrape-stop-root-"));
    await writeFile(join(root, "ABC-124.mp4"), "video");
    const control = createAbortAwareAggregation();
    const { fastify } = await createTestServer({ scrapeAggregation: control.aggregation });
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
      url: "/trpc/scrape.start",
      headers: { authorization: `Bearer ${token}` },
      payload: { refs: [{ rootId, relativePath: "ABC-124.mp4" }] },
    });
    const taskId = startResponse.json().result.data.id;
    await control.started;

    const stopResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.stop",
      headers: { authorization: `Bearer ${token}` },
      payload: { taskId },
    });

    expect(stopResponse.statusCode).toBe(200);
    await control.aborted;
    await expect
      .poll(async () => {
        const detailResponse = await fastify.inject({
          method: "GET",
          url: `/trpc/tasks.detail?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
          headers: { authorization: `Bearer ${token}` },
        });
        return detailResponse.json().result.data.task.status;
      })
      .toBe("failed");

    const resultsResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/scrape.listResults?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resultsResponse.json().result.data.results[0]).toMatchObject({
      status: "skipped",
      error: "刮削已停止",
    });
  });

  it("runs maintenance preview and apply through task-backed logs", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-maintenance-root-"));
    const nfoGenerator = new NfoGenerator();
    await writeFile(join(root, "ABC-125.mp4"), "video");
    await writeFile(
      join(root, "ABC-125.nfo"),
      nfoGenerator.buildXml({
        title: "Local Title ABC-125",
        number: "ABC-125",
        actors: ["Actor M"],
        genres: ["Drama"],
        scene_images: [],
        website: Website.JAVDB,
      }),
    );
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
      url: "/trpc/maintenance.start",
      headers: { authorization: `Bearer ${token}` },
      payload: { rootId, presetId: "read_local" },
    });
    const taskId = startResponse.json().result.data.id;

    await expect
      .poll(async () => {
        const detailResponse = await fastify.inject({
          method: "GET",
          url: `/trpc/tasks.detail?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
          headers: { authorization: `Bearer ${token}` },
        });
        return detailResponse.json().result.data.task.status;
      })
      .toBe("completed");

    const previewResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/maintenance.preview?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const preview = previewResponse.json().result.data;
    const applyResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/maintenance.execute",
      headers: { authorization: `Bearer ${token}` },
      payload: { taskId, confirmationToken: preview.confirmationToken },
    });
    const logsResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/logs.list",
      headers: { authorization: `Bearer ${token}` },
    });
    const libraryResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/library.search",
      headers: { authorization: `Bearer ${token}` },
      payload: { query: "ABC-125", limit: 20 },
    });
    const tasksResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/tasks.list",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(previewResponse.statusCode).toBe(200);
    expect(preview.items[0]).toMatchObject({
      presetId: "read_local",
      relativePath: "ABC-125.mp4",
      status: "ready",
      proposedCrawlerData: { number: "ABC-125", title: "Local Title ABC-125" },
    });
    expect(applyResponse.statusCode).toBe(200);
    expect(applyResponse.json().result.data.applied[0]).toMatchObject({
      relativePath: "ABC-125.mp4",
      status: "success",
    });
    expect(tasksResponse.json().result.data.tasks.some((task: { kind: string }) => task.kind === "maintenance")).toBe(
      true,
    );
    expect(libraryResponse.json().result.data.entries[0]).toMatchObject({
      number: "ABC-125",
      relativePath: "ABC-125.mp4",
      title: "Local Title ABC-125",
    });
    expect(logsResponse.json().result.data.logs).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: "task", message: expect.stringContaining("维护") })]),
    );
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

  it("serves the WebUI static bundle and falls back to index.html for routes", async () => {
    const webRoot = await mkdtemp(join(tmpdir(), "mdcz-web-static-"));
    await writeFile(join(webRoot, "index.html"), '<!doctype html><div id="root"></div>', "utf8");
    await writeFile(join(webRoot, "app.js"), "console.log('web')", "utf8");
    serverApp = buildServer({ webStaticDir: webRoot });
    const { fastify } = serverApp;

    const assetResponse = await fastify.inject({ method: "GET", url: "/app.js" });
    const routeResponse = await fastify.inject({ method: "GET", url: "/settings" });
    const rootResponse = await fastify.inject({ method: "GET", url: "/" });

    expect(assetResponse.statusCode).toBe(200);
    expect(assetResponse.headers["content-type"]).toContain("text/javascript");
    expect(assetResponse.body).toBe("console.log('web')");
    expect(routeResponse.statusCode).toBe(200);
    expect(routeResponse.headers["content-type"]).toContain("text/html");
    expect(routeResponse.body).toContain('<div id="root"></div>');
    expect(rootResponse.statusCode).toBe(200);
    expect(rootResponse.headers["content-type"]).toContain("text/html");
    expect(rootResponse.body).toContain('<div id="root"></div>');
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
    const listenerCountWithSse = services.taskEvents.listenerCount();

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

    await expect.poll(() => services.taskEvents.listenerCount()).toBe(listenerCountWithSse - 1);
  });
});

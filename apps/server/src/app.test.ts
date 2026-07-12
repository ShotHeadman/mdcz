import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AggregationResult,
  type ManualScrapeOptions,
  type MountedRootScrapeAggregationService,
  NfoGenerator,
} from "@mdcz/runtime/scrape";
import { type Configuration, defaultConfiguration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer, type ServerApp } from "./app";
import { closeTestServers, createTestServer, releaseTestServer, syncMediaRootFromConfig } from "./app.testSupport";
import type { RuntimeActionService } from "./services/runtimeActionService";
import { formatSseEvent } from "./taskEvents";

const textDecoder = new TextDecoder();

const readStreamChunk = async (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> => {
  const chunk = await reader.read();

  if (chunk.done) {
    throw new Error("Expected SSE stream chunk before stream ended");
  }

  return textDecoder.decode(chunk.value);
};

let standaloneServerApp: ServerApp | undefined;

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

const isWebhookTaskBody = (
  body: unknown,
  expected: { taskId: string; kind: string; status: string },
): body is { taskId: string; kind: string; status: string } =>
  typeof body === "object" &&
  body !== null &&
  "taskId" in body &&
  "kind" in body &&
  "status" in body &&
  body.taskId === expected.taskId &&
  body.kind === expected.kind &&
  body.status === expected.status;

const createFakeRuntimeActions = (): RuntimeActionService =>
  ({
    ensureWatermarkDirectory: async () => ({ path: "/server-data/watermark" }),
    listCrawlerSites: async () => ({
      sites: [{ site: Website.JAVDB, name: "javdb", enabled: true, native: true }],
    }),
    probeSiteConnectivity: async (input: { site: Website }) => ({
      ok: true,
      message: `HTTP 200 · ${input.site}`,
      latencyMs: 12,
      status: 200,
      resolvedUrl: "https://javdb.com/",
    }),
    checkCookies: async () => ({
      results: [
        { site: "JavDB", valid: true, message: "Cookie 有效" },
        { site: "JavBus", valid: false, message: "未配置 Cookie" },
      ],
    }),
    testLlm: async (input: { llmModelName?: string }) => ({
      success: Boolean(input.llmModelName),
      message: input.llmModelName ? `连接成功，LLM 回复: ${input.llmModelName}` : "请先填写 LLM 模型名称",
    }),
  }) as RuntimeActionService;

const createPngBytes = (): Buffer => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mP8z8BQDwAFgwJ/lUOh9QAAAABJRU5ErkJggg==",
    "base64",
  );
  return Buffer.concat([png, Buffer.alloc(9000)]);
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
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
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

const createAmbiguousUncensoredAggregation = (imageUrl: string): MountedRootScrapeAggregationService => ({
  async aggregate(number: string): Promise<AggregationResult> {
    return {
      data: {
        title: `Runtime UC Title ${number}`,
        title_zh: `运行时无码标题 ${number}`,
        number,
        actors: ["Actor A"],
        genres: ["无码"],
        studio: "Runtime Studio",
        plot: "Runtime plot",
        release_date: "2024-01-15",
        thumb_url: imageUrl,
        poster_url: imageUrl,
        fanart_url: imageUrl,
        scene_images: [],
        website: Website.JAVDB,
      },
      sources: {
        title: Website.JAVDB,
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
  await closeTestServers();
  await standaloneServerApp?.fastify.close();
  standaloneServerApp = undefined;
});

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      __mdczImpitMock?: { fetch: (url: string, init?: RequestInit) => Promise<Response> };
    }
  ).__mdczImpitMock = {
    fetch: (url, init) => fetch(url, init),
  };
});

describe("buildServer", () => {
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
    const config = await services.config.get();
    const roots = await services.mediaRoots.list();

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
    expect(config.paths.mediaPath).toBe(root);
    expect(roots.roots).toHaveLength(1);
    expect(roots.roots[0]).toMatchObject({ displayName: "Media", hostPath: root, enabled: true });
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
    const readPostResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/config.read",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    const exportResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/config.export",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(readResponse.statusCode).toBe(200);
    expect(readResponse.json().result.data.network.timeout).toBe(defaultConfiguration.network.timeout);
    expect(readPostResponse.statusCode).toBe(200);
    expect(readPostResponse.json().result.data.network.timeout).toBe(defaultConfiguration.network.timeout);
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
    services.runtimeLogs.append("test-runtime", "info", "runtime info");

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
    expect(logsResponse.statusCode).toBe(200);
    expect(logsResponse.json().result.data.logs[0]).toMatchObject({
      level: "WARN",
      message: "runtime warning",
      source: "runtime",
    });
    expect(logsResponse.json().result.data.logs[1]).toMatchObject({
      level: "INFO",
      message: "runtime info",
      source: "runtime",
    });
    expect(catalogResponse.statusCode).toBe(200);
    expect(catalogResponse.json().result.data.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "single-file-scraper" })]),
    );
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

  it("syncs the single enabled media root from paths.mediaPath", async () => {
    const firstRoot = await mkdtemp(join(tmpdir(), "mdcz-config-media-root-a-"));
    const secondRoot = await mkdtemp(join(tmpdir(), "mdcz-config-media-root-b-"));
    const { fastify } = await createTestServer();
    const loginResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "admin" },
    });
    const token = loginResponse.json().result.data.token;

    const firstResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/config.update",
      headers: { authorization: `Bearer ${token}` },
      payload: { paths: { mediaPath: firstRoot } },
    });
    const secondResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/config.update",
      headers: { authorization: `Bearer ${token}` },
      payload: { paths: { mediaPath: secondRoot } },
    });
    const rootsResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/mediaRoots.list",
      headers: { authorization: `Bearer ${token}` },
    });

    const roots = rootsResponse.json().result.data.roots;
    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(200);
    expect(roots.filter((root: { enabled: boolean }) => root.enabled)).toEqual([
      expect.objectContaining({ hostPath: secondRoot }),
    ]);
  });

  it("exposes protected settings parity runtime actions through dedicated tRPC routers", async () => {
    const { fastify } = await createTestServer({ runtimeActions: createFakeRuntimeActions() });
    const loginResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "admin" },
    });
    const token = loginResponse.json().result.data.token;

    const listSitesResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/crawler.listSites",
      headers: { authorization: `Bearer ${token}` },
    });
    const probeResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/crawler.probeSiteConnectivity",
      headers: { authorization: `Bearer ${token}` },
      payload: { site: Website.JAVDB },
    });
    const cookiesResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/network.checkCookies",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    const llmResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/translate.testLlm",
      headers: { authorization: `Bearer ${token}` },
      payload: { llmModelName: "gpt-test" },
    });
    const watermarkResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/app.ensureWatermarkDirectory",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    const unauthorizedResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/network.checkCookies",
      payload: {},
    });

    expect(listSitesResponse.statusCode).toBe(200);
    expect(listSitesResponse.json().result.data.sites).toEqual([
      { site: Website.JAVDB, name: "javdb", enabled: true, native: true },
    ]);
    expect(probeResponse.statusCode).toBe(200);
    expect(probeResponse.json().result.data).toMatchObject({
      ok: true,
      status: 200,
      resolvedUrl: "https://javdb.com/",
    });
    expect(cookiesResponse.statusCode).toBe(200);
    expect(cookiesResponse.json().result.data.results).toEqual(
      expect.arrayContaining([expect.objectContaining({ site: "JavDB", valid: true })]),
    );
    expect(llmResponse.statusCode).toBe(200);
    expect(llmResponse.json().result.data).toMatchObject({
      success: true,
      message: expect.stringContaining("gpt-test"),
    });
    expect(watermarkResponse.statusCode).toBe(200);
    expect(watermarkResponse.json().result.data.path).toBe("/server-data/watermark");
    expect(unauthorizedResponse.statusCode).toBe(401);
    expect(unauthorizedResponse.json().error.message).toContain("Authentication required");
  });

  it("exposes synced media roots as read-only tRPC state", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-media-root-"));
    const { fastify } = await createTestServer();
    const loginResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "admin" },
    });
    const token = loginResponse.json().result.data.token;

    const rootId = await syncMediaRootFromConfig(fastify, token, root);
    const listResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/mediaRoots.list",
      headers: { authorization: `Bearer ${token}` },
    });
    const createResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/mediaRoots.create",
      headers: { authorization: `Bearer ${token}` },
      payload: { displayName: "Media", hostPath: root, enabled: true },
    });
    const availabilityResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/mediaRoots.availability?input=${encodeURIComponent(JSON.stringify({ id: rootId }))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const updateResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/mediaRoots.update",
      headers: { authorization: `Bearer ${token}` },
      payload: { id: rootId, displayName: "Renamed", hostPath: root },
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().result.data.roots).toEqual([
      expect.objectContaining({
        id: rootId,
        hostPath: root,
        enabled: true,
        rootType: "mounted-filesystem",
      }),
    ]);
    expect(createResponse.statusCode).toBe(404);
    expect(availabilityResponse.statusCode).toBe(404);
    expect(updateResponse.statusCode).toBe(404);
  });

  it("builds overview fallback output from library entries independently of recent visibility", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-overview-root-"));
    await writeFile(join(root, "visible.mp4"), "visible");
    await writeFile(join(root, "hidden.mp4"), "hidden entry bytes");
    const { fastify, services } = await createTestServer();
    const loginResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "admin" },
    });
    const token = loginResponse.json().result.data.token;
    const rootId = await syncMediaRootFromConfig(fastify, token, root);
    const state = await services.persistence.getState();
    await state.repositories.library.upsertEntry({
      id: "visible-entry",
      rootId,
      rootRelativePath: "visible.mp4",
      size: 7,
      title: null,
      number: "ABC-002",
      createdAt: new Date("2026-05-11T00:00:00.000Z"),
    });
    const hidden = await state.repositories.library.upsertEntry({
      id: "hidden-entry",
      rootId,
      rootRelativePath: "hidden.mp4",
      size: 18,
      title: "Hidden",
      number: "ABC-001",
      createdAt: new Date("2026-05-10T00:00:00.000Z"),
    });
    await state.repositories.library.hideFromRecent(hidden.id, new Date("2026-05-12T00:00:00.000Z"));
    for (let index = 0; index < 8; index += 1) {
      await state.repositories.library.upsertEntry({
        id: `newer-entry-${index}`,
        rootId,
        rootRelativePath: `newer-${index}.mp4`,
        size: 1,
        title: `Newer ${index}`,
        number: `ABC-10${index}`,
        createdAt: new Date(`2026-05-11T00:0${index + 1}:00.000Z`),
      });
    }

    const overviewResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/overview.summary",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(overviewResponse.statusCode).toBe(200);
    expect(overviewResponse.json().result.data.output).toEqual({
      fileCount: 10,
      totalBytes: 33,
      outputAt: "2026-05-11T00:08:00.000Z",
      rootPath: null,
    });
    const recentAcquisitions = overviewResponse.json().result.data.recentAcquisitions;
    expect(recentAcquisitions).toHaveLength(8);
    expect(recentAcquisitions[0]).toMatchObject({
      id: "newer-entry-7",
      number: "ABC-107",
      completedAt: "2026-05-11T00:08:00.000Z",
    });
    expect(recentAcquisitions.map((entry: { id: string }) => entry.id)).not.toContain("hidden-entry");
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
    await fastify.inject({
      method: "POST",
      url: "/trpc/config.update",
      headers: { authorization: `Bearer ${token}` },
      payload: { paths: { mediaPath: root } },
    });
    const rootsResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/mediaRoots.list",
      headers: { authorization: `Bearer ${token}` },
    });
    const rootId = rootsResponse
      .json()
      .result.data.roots.find((rootDto: { hostPath: string }) => rootDto.hostPath === root)?.id;
    if (!rootId) {
      throw new Error("Expected paths.mediaPath to create an enabled media root");
    }

    const response = await fastify.inject({
      method: "GET",
      url: `/trpc/browser.list?input=${encodeURIComponent(JSON.stringify({ rootId, relativePath: ".." }))}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.message).toContain("escapes media root");
  });

  it("suggests server host directories through tRPC without returning files", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-server-path-api-"));
    await mkdir(join(root, "Alpha"));
    await mkdir(join(root, "Beta"));
    await writeFile(join(root, "Alpha.txt"), "not a directory");
    const { fastify } = await createTestServer();
    const loginResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "admin" },
    });
    const token = loginResponse.json().result.data.token;
    await syncMediaRootFromConfig(fastify, token, root);

    const typedResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/serverPaths.suggest",
      headers: { authorization: `Bearer ${token}` },
      payload: { path: join(root, "Al"), intent: "settings" },
    });
    const rootResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/serverPaths.suggest",
      headers: { authorization: `Bearer ${token}` },
      payload: { path: "", intent: "media-root" },
    });

    expect(typedResponse.statusCode).toBe(200);
    expect(typedResponse.json().result.data.entries).toEqual([
      expect.objectContaining({ name: "Alpha", type: "directory" }),
    ]);
    expect(rootResponse.json().result.data.entries.map((entry: { path: string }) => entry.path)).toContain(
      process.platform === "win32" ? root.replaceAll("\\", "/") : root,
    );
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
    await fastify.inject({
      method: "POST",
      url: "/trpc/config.update",
      headers: { authorization: `Bearer ${token}` },
      payload: { paths: { mediaPath: root } },
    });
    const rootsResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/mediaRoots.list",
      headers: { authorization: `Bearer ${token}` },
    });
    const rootId = rootsResponse
      .json()
      .result.data.roots.find((rootDto: { hostPath: string }) => rootDto.hostPath === root)?.id;
    if (!rootId) {
      throw new Error("Expected paths.mediaPath to create an enabled media root");
    }

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
      summary: `扫描 ${root.split(/[\\/]+/u).at(-1)}: queued`,
      errors: [],
    });
    expect(recentResponse.statusCode).toBe(200);
    expect(recentResponse.json().tasks[0]).toMatchObject({
      taskId,
      kind: "scan",
      status: "completed",
      summary: `扫描 ${root.split(/[\\/]+/u).at(-1)}: completed`,
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
    await fastify.inject({
      method: "POST",
      url: "/trpc/config.update",
      headers: { authorization: `Bearer ${token}` },
      payload: { paths: { mediaPath: root } },
    });
    const rootsResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/mediaRoots.list",
      headers: { authorization: `Bearer ${token}` },
    });
    const rootId = rootsResponse
      .json()
      .result.data.roots.find((rootDto: { hostPath: string }) => rootDto.hostPath === root)?.id;
    if (!rootId) {
      throw new Error("Expected paths.mediaPath to create an enabled media root");
    }

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

    await expect
      .poll(() =>
        webhook.deliveries.some((delivery) =>
          isWebhookTaskBody(delivery.body, { taskId, kind: "scan", status: "completed" }),
        ),
      )
      .toBe(true);
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
    expect(statusResponse.json().webhook.delivered).toBeGreaterThanOrEqual(2);

    await webhook.close();
  });

  it("runs the full scrape runtime pipeline and indexes organized output", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-scrape-runtime-root-"));
    const actorRoot = await mkdtemp(join(tmpdir(), "mdcz-actor-root-"));
    const actorPhotoPath = join(actorRoot, "Actor A.jpg");
    await writeFile(join(root, "ABC-123.mp4"), "video");
    await writeFile(actorPhotoPath, createPngBytes());
    const imageServer = await startImageServer();
    const { fastify, services } = await createTestServer({
      scrapeAggregation: createFakeAggregation(imageServer.url, actorPhotoPath),
    });
    const taskEvents: unknown[] = [];
    const unsubscribeTaskEvents = services.taskEvents.subscribe((event) => {
      taskEvents.push(event.data);
    });
    const loginResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "admin" },
    });
    const token = loginResponse.json().result.data.token;
    await fastify.inject({
      method: "POST",
      url: "/trpc/config.update",
      headers: { authorization: `Bearer ${token}` },
      payload: { paths: { mediaPath: root } },
    });
    const rootsResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/mediaRoots.list",
      headers: { authorization: `Bearer ${token}` },
    });
    const rootId = rootsResponse
      .json()
      .result.data.roots.find((rootDto: { hostPath: string }) => rootDto.hostPath === root)?.id;
    if (!rootId) {
      throw new Error("Expected paths.mediaPath to create an enabled media root");
    }
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
    expect(startResponse.json().result.data.videoCount).toBe(0);

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
    const logsResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/logs.list",
      headers: { authorization: `Bearer ${token}` },
    });
    const assetResponse = await fastify.inject({
      method: "GET",
      url: `/api/library/assets/${encodeURIComponent(rootId)}/${encodeURI("JAV_output/Actor A/ABC-123/poster.png")}?token=${encodeURIComponent(token)}`,
    });
    const unauthorizedAssetResponse = await fastify.inject({
      method: "GET",
      url: `/api/library/assets/${encodeURIComponent(rootId)}/${encodeURI("JAV_output/Actor A/ABC-123/poster.png")}`,
    });
    const escapingAssetResponse = await fastify.inject({
      method: "GET",
      url: `/api/library/assets/${encodeURIComponent(rootId)}/..%2Fconfig%2Fdefault.png?token=${encodeURIComponent(token)}`,
    });
    const outputRelativePath = "JAV_output/Actor A/ABC-123/ABC-123.mp4";
    const nfoRelativePath = "JAV_output/Actor A/ABC-123/ABC-123.nfo";
    const nfoContent = await readFile(join(root, nfoRelativePath), "utf8");
    const actorPhotoContent = await readFile(join(root, "JAV_output/Actor A/ABC-123/.actors/Actor A.jpg"));
    const posterContent = await readFile(join(root, "JAV_output/Actor A/ABC-123/poster.png"));

    expect(libraryResponse.statusCode).toBe(200);
    expect(libraryResponse.json().result.data.total).toBe(1);
    expect(entry).toMatchObject({
      actors: ["Actor A"],
      available: true,
      fileName: "ABC-123.mp4",
      mediaIdentity: "ABC-123",
      number: "ABC-123",
      rootId,
      rootDisplayName: root.split(/[\\/]+/u).at(-1),
    });
    expect(entry.relativePath).toBe(outputRelativePath);
    expect(entry.thumbnailPath).toBe("JAV_output/Actor A/ABC-123/poster.png");
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
    expect(posterContent.length).toBeGreaterThan(0);
    expect(assetResponse.statusCode).toBe(200);
    expect(assetResponse.headers["content-type"]).toContain("image/png");
    expect(Buffer.from(assetResponse.rawPayload).length).toBe(posterContent.length);
    expect(unauthorizedAssetResponse.statusCode).toBe(401);
    expect(escapingAssetResponse.statusCode).toBe(400);
    expect(overviewResponse.json().result.data.recentAcquisitions[0]).toMatchObject({
      id: entry.id,
      rootId,
      number: "ABC-123",
      available: true,
    });
    const logMessages = logsResponse.json().result.data.logs.map((log: { message: string }) => log.message);
    expect(logMessages).toEqual(
      expect.arrayContaining([expect.stringMatching(/^Starting scrape task .+ for ABC-123$/u)]),
    );
    expect(logMessages.some((message: string) => message.includes("刮削进度"))).toBe(false);
    expect(taskEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "task-progress",
          taskKind: "scrape",
          value: expect.any(Number),
        }),
      ]),
    );
    expect(
      taskEvents.some(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          "kind" in event &&
          event.kind === "log" &&
          "log" in event &&
          typeof event.log === "object" &&
          event.log !== null &&
          "message" in event.log &&
          typeof event.log.message === "string" &&
          event.log.message.includes("刮削进度"),
      ),
    ).toBe(false);
    unsubscribeTaskEvents();
    await imageServer.close();
  });

  it("starts scrape tasks from selected host files inside scan and media roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-selected-scrape-root-"));
    const selectedPath = join(root, "ABC-128.mp4");
    await writeFile(selectedPath, "video");
    const imageServer = await startImageServer();
    const { fastify } = await createTestServer({ scrapeAggregation: createFakeAggregation(imageServer.url) });
    const loginResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "admin" },
    });
    const token = loginResponse.json().result.data.token;
    await fastify.inject({
      method: "POST",
      url: "/trpc/config.update",
      headers: { authorization: `Bearer ${token}` },
      payload: { paths: { mediaPath: root } },
    });
    const rootsResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/mediaRoots.list",
      headers: { authorization: `Bearer ${token}` },
    });
    const rootId = rootsResponse
      .json()
      .result.data.roots.find((rootDto: { hostPath: string }) => rootDto.hostPath === root)?.id;
    if (!rootId) {
      throw new Error("Expected paths.mediaPath to create an enabled media root");
    }

    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.startSelectedFiles",
      headers: { authorization: `Bearer ${token}` },
      payload: { filePaths: [selectedPath], scanDir: root, uncensoredConfirmed: true },
    });

    expect(startResponse.statusCode).toBe(200);
    expect(startResponse.json().result.data).toMatchObject({
      kind: "scrape",
      rootId,
      status: expect.stringMatching(/queued|running|completed/),
    });
    const taskId = startResponse.json().result.data.id;

    const resultsResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/scrape.listResults?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resultsResponse.json().result.data.results[0]).toMatchObject({
      rootId,
      relativePath: "ABC-128.mp4",
    });
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
    await imageServer.close();
  });

  it("emits ambiguous uncensored items on scrape completion and restarts confirmed refs", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-ambiguous-uncensored-root-"));
    await writeFile(join(root, "ABP-999-U.mp4"), "video");
    const imageServer = await startImageServer();
    const { fastify, services } = await createTestServer({
      scrapeAggregation: createAmbiguousUncensoredAggregation(imageServer.url),
    });
    const completedEvents: unknown[] = [];
    services.taskEvents.subscribe((event) => {
      if (event.data.kind === "event" && event.data.event.type === "completed") {
        completedEvents.push(event.data);
      }
    });
    const loginResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "admin" },
    });
    const token = loginResponse.json().result.data.token;
    const rootId = await syncMediaRootFromConfig(fastify, token, root);
    await fastify.inject({
      method: "POST",
      url: "/trpc/config.update",
      headers: { authorization: `Bearer ${token}` },
      payload: { behavior: { successFileMove: false, successFileRename: false } },
    });

    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.start",
      headers: { authorization: `Bearer ${token}` },
      payload: { refs: [{ rootId, relativePath: "ABP-999-U.mp4" }] },
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

    const firstCompletedEvent = completedEvents.at(-1) as {
      ambiguousUncensoredItems?: Array<{
        nfoRelativePath: string | null;
        number: string;
        ref: { rootId: string; relativePath: string };
      }>;
    };
    expect(firstCompletedEvent.ambiguousUncensoredItems).toEqual([
      expect.objectContaining({
        ref: { rootId, relativePath: "ABP-999-U.mp4" },
        number: "ABP-999",
        nfoRelativePath: expect.stringContaining("ABP-999-U.nfo"),
      }),
    ]);

    const confirmResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.confirmUncensored",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        taskId,
        items: [{ ref: { rootId, relativePath: "ABP-999-U.mp4" }, choice: "leak" }],
      },
    });

    expect(confirmResponse.statusCode).toBe(200);
    expect(confirmResponse.json().result.data).toMatchObject({
      kind: "scrape",
      rootId,
      status: expect.stringMatching(/queued|running|completed/),
    });
    expect(confirmResponse.json().result.data.id).not.toBe(taskId);
    const confirmedTaskId = confirmResponse.json().result.data.id;

    await expect
      .poll(async () => {
        const detailResponse = await fastify.inject({
          method: "GET",
          url: `/trpc/tasks.detail?input=${encodeURIComponent(JSON.stringify({ taskId: confirmedTaskId }))}`,
          headers: { authorization: `Bearer ${token}` },
        });
        return detailResponse.json().result.data.task.status;
      })
      .toBe("completed");
    const confirmedResultsResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/scrape.listResults?input=${encodeURIComponent(JSON.stringify({ taskId: confirmedTaskId }))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(confirmedResultsResponse.json().result.data.results[0]?.uncensoredAmbiguous).toBe(false);
    await imageServer.close();
  });

  it("accepts each uncensored confirmation choice", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-uncensored-choice-root-"));
    const { fastify, services } = await createTestServer();
    const loginResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "admin" },
    });
    const token = loginResponse.json().result.data.token;
    const rootId = await syncMediaRootFromConfig(fastify, token, root);
    const state = await services.persistence.getState();
    const task = await state.repositories.tasks.createTask({ kind: "scrape", rootId });
    for (const relativePath of ["UMR-001.mp4", "LEAK-001.mp4", "UNC-001.mp4"]) {
      await state.repositories.library.upsertScrapeResult({
        taskId: task.id,
        rootId,
        relativePath,
        status: "success",
        uncensoredAmbiguous: true,
      });
    }

    const confirmResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.confirmUncensored",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        taskId: task.id,
        items: [
          { ref: { rootId, relativePath: "UMR-001.mp4" }, choice: "umr" },
          { ref: { rootId, relativePath: "LEAK-001.mp4" }, choice: "leak" },
          { ref: { rootId, relativePath: "UNC-001.mp4" }, choice: "uncensored" },
        ],
      },
    });

    expect(confirmResponse.statusCode).toBe(200);
    const queuedResults = await state.repositories.library.listScrapeResults(confirmResponse.json().result.data.id);
    expect(queuedResults.map((result) => result.relativePath).sort()).toEqual([
      "LEAK-001.mp4",
      "UMR-001.mp4",
      "UNC-001.mp4",
    ]);
  });

  it("scans selected maintenance files through runtime semantics", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-maintenance-selected-root-"));
    await writeFile(join(root, "ABC-225.mp4"), "video");
    await writeFile(
      join(root, "ABC-225.nfo"),
      new NfoGenerator().buildXml({
        title: "Local Title ABC-225",
        number: "ABC-225",
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
    const rootId = await syncMediaRootFromConfig(fastify, token, root);

    const scanResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/maintenance.scanSelectedFiles?input=${encodeURIComponent(
        JSON.stringify({ filePaths: [join(root, "ABC-225.mp4")], scanDir: root }),
      )}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(scanResponse.statusCode).toBe(200);
    expect(scanResponse.json().result.data.entries[0]).toMatchObject({
      fileId: `${rootId}:ABC-225.mp4`,
      rootRef: { rootId, relativePath: "ABC-225.mp4" },
      crawlerData: { number: "ABC-225", title: "Local Title ABC-225" },
    });
  });

  it("rejects uncensored confirmation refs outside the task", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-uncensored-invalid-root-"));
    const { fastify } = await createTestServer();
    const loginResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "admin" },
    });
    const token = loginResponse.json().result.data.token;
    const rootId = await syncMediaRootFromConfig(fastify, token, root);
    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.start",
      headers: { authorization: `Bearer ${token}` },
      payload: { refs: [{ rootId, relativePath: "ABC-001.mp4" }] },
    });

    const confirmResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.confirmUncensored",
      headers: { authorization: `Bearer ${token}` },
      payload: { taskId: startResponse.json().result.data.id, refs: [{ rootId, relativePath: "NOPE-001.mp4" }] },
    });

    expect(confirmResponse.statusCode).toBe(400);
    expect(confirmResponse.json().error.message).toContain("Ref does not belong to scrape task");
  });

  it("rejects uncensored confirmation for a missing task", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-uncensored-missing-root-"));
    const { fastify } = await createTestServer();
    const loginResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "admin" },
    });
    const token = loginResponse.json().result.data.token;
    const rootId = await syncMediaRootFromConfig(fastify, token, root);

    const confirmResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.confirmUncensored",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        taskId: "missing-task",
        refs: [{ rootId, relativePath: "ABC-001.mp4" }],
      },
    });

    expect(confirmResponse.statusCode).toBe(400);
    expect(confirmResponse.json().error.message).toContain("Task not found");
  });

  it("rejects selected scrape files outside the requested scan directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-selected-scrape-root-"));
    const otherRoot = await mkdtemp(join(tmpdir(), "mdcz-selected-scrape-other-"));
    const selectedPath = join(otherRoot, "ABC-129.mp4");
    await writeFile(selectedPath, "video");
    const { fastify } = await createTestServer();
    const loginResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "admin" },
    });
    const token = loginResponse.json().result.data.token;
    await fastify.inject({
      method: "POST",
      url: "/trpc/config.update",
      headers: { authorization: `Bearer ${token}` },
      payload: { paths: { mediaPath: otherRoot } },
    });

    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.startSelectedFiles",
      headers: { authorization: `Bearer ${token}` },
      payload: { filePaths: [selectedPath], scanDir: root, uncensoredConfirmed: true },
    });

    expect(startResponse.statusCode).toBe(500);
    expect(startResponse.json().error.message).toContain("文件不在扫描目录内");
  });

  it("rejects selected scrape files outside configured media path", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-selected-unregistered-root-"));
    const configuredRoot = await mkdtemp(join(tmpdir(), "mdcz-configured-media-root-"));
    const selectedPath = join(root, "ABC-130.mp4");
    await writeFile(selectedPath, "video");
    const { fastify } = await createTestServer();
    const loginResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "admin" },
    });
    const token = loginResponse.json().result.data.token;
    await fastify.inject({
      method: "POST",
      url: "/trpc/config.update",
      headers: { authorization: `Bearer ${token}` },
      payload: { paths: { mediaPath: configuredRoot } },
    });

    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.startSelectedFiles",
      headers: { authorization: `Bearer ${token}` },
      payload: { filePaths: [selectedPath], scanDir: root, uncensoredConfirmed: true },
    });

    expect(startResponse.statusCode).toBe(500);
    expect(startResponse.json().error.message).toContain("文件不在已注册媒体目录内");
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
    const rootId = await syncMediaRootFromConfig(fastify, token, root);

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

  it("recovers and discards persisted recoverable scrape sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-scrape-recover-root-"));
    await writeFile(join(root, "ABC-126.mp4"), "video");
    await writeFile(join(root, "ABC-127.mp4"), "video");
    const { fastify, services } = await createTestServer();
    const loginResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "admin" },
    });
    const token = loginResponse.json().result.data.token;
    const rootId = await syncMediaRootFromConfig(fastify, token, root);
    const state = await services.persistence.getState();
    const recoverTask = await state.repositories.tasks.createTask({
      kind: "scrape",
      rootId,
      now: new Date(1_700_000_000_000),
    });
    await state.repositories.library.upsertScrapeResult({
      taskId: recoverTask.id,
      rootId,
      relativePath: "ABC-126.mp4",
      status: "processing",
    });
    await state.repositories.library.upsertScrapeResult({
      taskId: recoverTask.id,
      rootId,
      relativePath: "ABC-127.mp4",
      status: "failed",
      error: "boom",
    });
    await state.repositories.tasks.patch(recoverTask.id, { status: "failed", error: "interrupted" });

    const recoverableResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/scrape.getRecoverableSession",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(recoverableResponse.statusCode).toBe(200);
    expect(recoverableResponse.json().result.data).toMatchObject({
      recoverable: true,
      taskId: recoverTask.id,
      pendingCount: 1,
      failedCount: 1,
    });

    const resolveResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.resolveRecoverableSession",
      headers: { authorization: `Bearer ${token}` },
      payload: { action: "recover" },
    });
    expect(resolveResponse.statusCode).toBe(200);
    expect(resolveResponse.json().result.data.task.id).toBe(recoverTask.id);
    await expect(state.repositories.tasks.listEvents(recoverTask.id)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "queued", message: "恢复未完成刮削并重新排队" })]),
    );

    const discardTask = await state.repositories.tasks.createTask({
      kind: "scrape",
      rootId,
      now: new Date(1_700_000_001_000),
    });
    await state.repositories.library.upsertScrapeResult({
      taskId: discardTask.id,
      rootId,
      relativePath: "ABC-126.mp4",
      status: "processing",
    });
    await state.repositories.tasks.patch(discardTask.id, { status: "running" });
    const discardResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.resolveRecoverableSession",
      headers: { authorization: `Bearer ${token}` },
      payload: { action: "discard" },
    });
    expect(discardResponse.statusCode).toBe(200);
    expect(discardResponse.json().result.data).toMatchObject({
      success: true,
      task: null,
    });
    await expect(state.repositories.library.listScrapeResults(discardTask.id)).resolves.toEqual([
      expect.objectContaining({
        status: "skipped",
        error: "已放弃未完成刮削",
      }),
    ]);
    await expect(state.repositories.tasks.get(discardTask.id)).resolves.toMatchObject({
      status: "failed",
      error: "已放弃未完成刮削",
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
    const rootId = await syncMediaRootFromConfig(fastify, token, root);

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
      expect.arrayContaining([
        expect.objectContaining({ source: "task", message: expect.stringContaining("Maintenance") }),
      ]),
    );
  });

  it("closes the persistence database with the Fastify lifecycle", async () => {
    const app = await createTestServer();
    const { fastify, services } = app;

    await fastify.ready();
    expect(services.persistence.initialized).toBe(true);

    await fastify.close();
    expect(services.persistence.initialized).toBe(false);
    await releaseTestServer(app);
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
    standaloneServerApp = buildServer({ webStaticDir: webRoot });
    const { fastify } = standaloneServerApp;

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
      headers: { origin: "http://127.0.0.1:5173" },
      signal: abortController.signal,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");
    expect(response.headers.get("vary")).toBe("Origin");
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

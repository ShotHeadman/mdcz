import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfiguration } from "@mdcz/shared/config";
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

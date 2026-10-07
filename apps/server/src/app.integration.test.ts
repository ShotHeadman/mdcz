import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deterministicMediaRootId } from "@mdcz/media-store";
import { defaultConfiguration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeTestServers,
  createTempRoot,
  createTestAggregation,
  createTestLibrary,
  createTestServer,
  loginAsAdmin,
  releaseTestServer,
  startLocalHttpServer,
  startTestImageServer,
  waitForScrapeRunStatus,
} from "./app.testSupport";
import { AuthService } from "./services/authService";
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

const readStreamUntil = async (reader: ReadableStreamDefaultReader<Uint8Array>, needle: string): Promise<string> => {
  let buffer = "";
  while (!buffer.includes(needle)) {
    buffer += await readStreamChunk(reader);
  }
  return buffer;
};

const createFakeRuntimeActions = (): RuntimeActionService =>
  ({
    ensureWatermarkDirectory: async () => ({ path: "/server-data/watermark" }),
    listCrawlerSites: async () => ({
      sites: [{ site: Website.JAVDB, name: "javdb", enabled: true, native: true }],
    }),
    probeSiteConnectivity: async () => ({
      ok: true,
      latencyMs: 12,
      status: 200,
      resolvedUrl: "https://javdb.com/",
    }),
    checkCookies: async () => ({
      results: [
        { site: "JavDB", valid: true, status: "ready_with_cookie" as const },
        {
          site: "JavBus",
          valid: true,
          status: "ready_without_cookie" as const,
        },
      ],
    }),
    testTranslation: async (input: { llmModelName?: string }) =>
      input.llmModelName ? { status: "ok" as const, sample: input.llmModelName } : { status: "missing_model" as const },
  }) satisfies Pick<
    RuntimeActionService,
    "ensureWatermarkDirectory" | "listCrawlerSites" | "probeSiteConnectivity" | "checkCookies" | "testTranslation"
  > as unknown as RuntimeActionService;

const startWebhookServer = async (): Promise<{
  close: () => Promise<void>;
  deliveries: Array<{ body: unknown; secret?: string }>;
  url: string;
}> => {
  const deliveries: Array<{ body: unknown; secret?: string }> = [];
  const server = await startLocalHttpServer((request, response) => {
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

  return {
    deliveries,
    url: `${server.url}/webhook`,
    close: server.close,
  };
};

afterEach(async () => {
  await closeTestServers();
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

describe("buildServer composition integration", () => {
  it("publishes one durable hashed credential under concurrent first-run setup", async () => {
    const { fastify, services } = await createTestServer();
    const password = "changed-password";
    const statePath = join(services.config.runtimePaths.configDir, "auth-state.json");
    const results = await Promise.all(
      [password, "another-password"].map((value) =>
        fastify.inject({
          method: "POST",
          url: "/trpc/setup.complete",
          payload: { password: value },
        }),
      ),
    );
    expect(results.filter((result) => result.statusCode === 200)).toHaveLength(1);
    expect(results.filter((result) => [403, 409].includes(result.statusCode))).toHaveLength(1);
    const state = JSON.parse(await readFile(statePath, "utf8"));
    await expect(services.auth.completeSetup({ password: "replacement" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual(state);
    expect(Object.keys(state)).toEqual(["passwordHash"]);
    expect(state.passwordHash).toMatch(/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
    if (process.platform !== "win32") expect((await stat(statePath)).mode & 0o777).toBe(0o600);
    const status = await fastify.inject({ method: "GET", url: "/trpc/setup.status" });
    expect(status.json().result.data).toMatchObject({ configured: true, setupRequired: false, mediaRootCount: 0 });
    const restartedAuth = new AuthService(services.config.runtimePaths, services.persistence, "");
    const winningPassword = results[0].statusCode === 200 ? password : "another-password";
    if (process.platform !== "win32") await chmod(statePath, 0o400);
    try {
      await expect(restartedAuth.status()).resolves.toMatchObject({ setupRequired: false });
      await expect(restartedAuth.login(winningPassword)).resolves.toMatchObject({ authenticated: true });
      if (process.platform !== "win32") expect((await stat(statePath)).mode & 0o777).toBe(0o400);
    } finally {
      if (process.platform !== "win32") await chmod(statePath, 0o600);
    }
    await expect(restartedAuth.login("admin")).rejects.toThrow("Incorrect administrator password");
    const other = await createTestServer();
    await other.services.auth.completeSetup({
      password: winningPassword,
    });
    const otherState = JSON.parse(
      await readFile(join(other.services.config.runtimePaths.configDir, "auth-state.json"), "utf8"),
    );
    expect(otherState.passwordHash).not.toBe(state.passwordHash);
    await writeFile(statePath, "{}", "utf8");
    await expect(restartedAuth.status()).rejects.toThrow("Invalid auth-state.json");
  });

  it.each([
    "",
    "a",
    "admin",
    "  ",
    "密码",
    "x".repeat(1025),
  ])("accepts setup and login without password policy restrictions (case %#)", async (password) => {
    const { fastify } = await createTestServer();
    const response = await fastify.inject({
      method: "POST",
      url: "/trpc/setup.complete",
      payload: { password },
    });
    expect(response.statusCode).toBe(200);
    const login = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password },
    });
    expect(login.statusCode).toBe(200);
  });

  it("uses an environment password without persisting it or reopening setup for an empty media library", async () => {
    const environmentPassword = "a";
    const { fastify, services } = await createTestServer({ environmentPassword });
    const status = await fastify.inject({ method: "GET", url: "/trpc/auth.setup" });
    expect(status.json().result.data).toEqual({
      authenticated: false,
      setupRequired: false,
      environmentPasswordConfigured: true,
    });
    const denied = await fastify.inject({
      method: "POST",
      url: "/trpc/setup.complete",
      payload: { password: "another-password" },
    });
    expect(denied.statusCode).toBe(403);
    await expect(services.auth.login("wrong-password")).rejects.toThrow("Incorrect administrator password");
    await expect(services.auth.login(environmentPassword)).resolves.toMatchObject({ authenticated: true });
    await expect(readFile(join(services.config.runtimePaths.configDir, "auth-state.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("mounts tRPC config read and export procedures", async () => {
    const { fastify, services } = await createTestServer();
    await services.config.save(defaultConfiguration);
    const token = await loginAsAdmin(fastify);

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
    const token = await loginAsAdmin(fastify);
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
    const token = await loginAsAdmin(fastify);
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
    const { fastify, services } = await createTestServer();
    const token = await loginAsAdmin(fastify);

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
    const readResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/config.read",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    const resetPathResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/config.reset",
      headers: { authorization: `Bearer ${token}` },
      payload: { path: "network.timeout" },
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
    expect(readResponse.json().result.data.network.timeout).toBe(25);
    expect(resetPathResponse.json().result.data.network.timeout).toBe(
      defaultsResponse.json().result.data.network.timeout,
    );
    expect(resetResponse.statusCode).toBe(200);
    expect(resetResponse.json().result.data.network.timeout).toBe(defaultsResponse.json().result.data.network.timeout);
    expect(importResponse.statusCode).toBe(200);
    expect(importResponse.json().result.data.network.timeout).toBe(33);
    await expect(services.config.update({ download: { nfoNaming: "invalid" as never } })).rejects.toMatchObject({
      fields: ["download.nfoNaming"],
    });
  });

  it("registers each library's directories as media roots and rejects overlapping sources", async () => {
    const firstRoot = await createTempRoot("library-root-a");
    const secondRoot = await createTempRoot("library-root-b");
    const { fastify } = await createTestServer();
    const token = await loginAsAdmin(fastify);

    await createTestLibrary(fastify, token, firstRoot);
    await createTestLibrary(fastify, token, secondRoot, { placement: "inPlace", outputPath: "" });
    const overlapping = await fastify.inject({
      method: "POST",
      url: "/trpc/libraries.create",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Nested", sourcePath: join(firstRoot, "nested"), placement: "inPlace" },
    });
    const rootsResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/mediaRoots.list",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(overlapping.json().error.message).toContain("overlaps library");
    expect(
      rootsResponse
        .json()
        .result.data.roots.map((root: { hostPath: string }) => root.hostPath)
        .sort(),
    ).toEqual([firstRoot, secondRoot].sort());
  });
  it("prepares a missing library output directory before registering its root", async () => {
    const parent = await createTempRoot("library-output-parent");
    const source = join(parent, "downloads");
    const outputPath = join(parent, "nested", "JAV_output");
    await mkdir(source);
    const { fastify, services } = await createTestServer();
    const token = await loginAsAdmin(fastify);

    await createTestLibrary(fastify, token, source, { placement: "hardlink", outputPath });

    expect((await stat(outputPath)).isDirectory()).toBe(true);
    expect((await services.mediaRoots.list()).roots).toContainEqual(
      expect.objectContaining({ id: deterministicMediaRootId(outputPath), hostPath: outputPath }),
    );
  });
  it("rejects scrape requests without a library", async () => {
    const { fastify } = await createTestServer();
    const token = await loginAsAdmin(fastify);

    const response = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.start",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        executionMode: "batch",
        refs: [{ rootId: "root", relativePath: "movie.mp4" }],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("libraryId");
  });
  it("adopts single-directory settings as the first library once and rejects an unavailable source", async () => {
    const root = await createTempRoot("legacy-media-root");
    const app = await createTestServer();
    const { configPath } = app.services.config.runtimePaths;
    await mkdir(join(configPath, ".."), { recursive: true });
    await writeFile(configPath, `[paths]\nmediaPath = ${JSON.stringify(root)}\n[watch]\nenabled = true\n`, "utf8");
    const token = await loginAsAdmin(app.fastify);
    const libraries = async () =>
      (await app.services.libraries.list()).map(({ sourcePath, automation }) => ({ sourcePath, automation }));

    expect(await libraries()).toEqual([{ sourcePath: root, automation: "scrape" }]);
    const saved = await readFile(configPath, "utf8");
    expect(saved).not.toContain("mediaPath");
    expect(saved).not.toContain("[watch]");

    const response = await app.fastify.inject({
      method: "POST",
      url: "/trpc/libraries.create",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Offline", sourcePath: join(root, "..", "offline"), placement: "inPlace" },
    });
    expect(response.statusCode).toBe(500);
    expect(await libraries()).toEqual([{ sourcePath: root, automation: "scrape" }]);
  });
  it("exposes protected settings parity runtime actions through dedicated tRPC routers", async () => {
    const { fastify } = await createTestServer({ runtimeActions: createFakeRuntimeActions() });
    const token = await loginAsAdmin(fastify);

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
      url: "/trpc/translate.test",
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
      status: "ok",
      sample: "gpt-test",
    });
    expect(watermarkResponse.statusCode).toBe(200);
    expect(watermarkResponse.json().result.data.path).toBe("/server-data/watermark");
    expect(unauthorizedResponse.statusCode).toBe(401);
    expect(unauthorizedResponse.json().error.message).toContain("Authentication required");
  });

  it("exposes synced media roots as read-only tRPC state", async () => {
    const root = await createTempRoot("media-root");
    const { fastify } = await createTestServer();
    const token = await loginAsAdmin(fastify);

    const { rootId } = await createTestLibrary(fastify, token, root);
    const listResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/mediaRoots.list",
      headers: { authorization: `Bearer ${token}` },
    });
    const createResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/mediaRoots.create",
      headers: { authorization: `Bearer ${token}` },
      payload: { displayName: "Media", hostPath: root },
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
      }),
    ]);
    expect(createResponse.statusCode).toBe(404);
    expect(availabilityResponse.statusCode).toBe(404);
    expect(updateResponse.statusCode).toBe(404);
  });

  it("builds overview fallback output from library entries independently of recent visibility", async () => {
    const root = await createTempRoot("overview-root");
    await writeFile(join(root, "visible.mp4"), "visible");
    await writeFile(join(root, "hidden.mp4"), "hidden entry bytes");
    const { fastify, services } = await createTestServer();
    const token = await loginAsAdmin(fastify);
    const { rootId } = await createTestLibrary(fastify, token, root);
    const state = await services.persistence.getState();
    await state.repositories.library.upsertEntry({
      movie: { id: "visible-entry", title: null, number: "ABC-002", createdAt: new Date("2026-05-11T00:00:00.000Z") },
      files: [{ rootId, rootRelativePath: "visible.mp4", size: 7, fileId: `${rootId}:visible.mp4` }],
    });
    const hidden = await state.repositories.library.upsertEntry({
      movie: {
        id: "hidden-entry",
        title: "Hidden",
        number: "ABC-001",
        createdAt: new Date("2026-05-10T00:00:00.000Z"),
      },
      files: [{ rootId, rootRelativePath: "hidden.mp4", size: 18, fileId: `${rootId}:hidden.mp4` }],
    });
    await state.repositories.library.hideFromRecent(hidden.id, new Date("2026-05-12T00:00:00.000Z"));
    for (let index = 0; index < 8; index += 1) {
      await state.repositories.library.upsertEntry({
        movie: {
          id: `newer-entry-${index}`,
          title: `Newer ${index}`,
          number: `ABC-10${index}`,
          createdAt: new Date(`2026-05-11T00:0${index + 1}:00.000Z`),
        },
        files: [
          {
            rootId,
            rootRelativePath: `newer-${index}.mp4`,
            size: 1,
            fileId: `${rootId}:newer-${index}.mp4`,
          },
        ],
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

  it.each([false, true])("paginates movies and checks each file (partially available: %s)", async (partial) => {
    const root = await createTempRoot("library-page-root");
    await writeFile(join(root, "present-a.mp4"), "a");
    await writeFile(join(root, "present-b.mp4"), "b");
    const { fastify, services } = await createTestServer();
    const token = await loginAsAdmin(fastify);
    const { rootId } = await createTestLibrary(fastify, token, root);
    const state = await services.persistence.getState();
    for (const [id, relativePath, createdAt] of [
      ["entry-a", "present-a.mp4", "2026-05-01T00:00:00.000Z"],
      ["entry-b", "present-b.mp4", "2026-05-02T00:00:00.000Z"],
      ["entry-c", "missing-c.mp4", "2026-05-03T00:00:00.000Z"],
    ] as const) {
      await state.repositories.library.upsertEntry({
        movie: { id, number: id, createdAt: new Date(createdAt) },
        files: [{ rootId, rootRelativePath: relativePath, size: 1, fileId: `${rootId}:${relativePath}` }],
      });
    }

    if (partial) {
      await writeFile(join(root, "present-c.mp4"), "present");
      await state.repositories.library.upsertEntry({
        movie: { id: "entry-c" },
        files: [
          {
            rootId,
            rootRelativePath: "present-c.mp4",
            size: 7,
            fileId: `${rootId}:present-c.mp4`,
          },
        ],
      });
    }

    const firstResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/library.list",
      headers: { authorization: `Bearer ${token}` },
      payload: { limit: 2 },
    });
    const firstPage = firstResponse.json().result.data;
    const secondResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/library.list",
      headers: { authorization: `Bearer ${token}` },
      payload: { cursor: firstPage.nextCursor, limit: 2 },
    });
    const secondPage = secondResponse.json().result.data;
    const availabilityResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/library.availability",
      headers: { authorization: `Bearer ${token}` },
      payload: { ids: firstPage.entries.map((entry: { id: string }) => entry.id) },
    });

    expect(firstPage).toMatchObject({
      entries: [
        expect.objectContaining({
          id: "entry-c",
          available: "unchecked",
        }),
        expect.objectContaining({ id: "entry-b", available: "unchecked" }),
      ],
      hasMore: true,
      total: 3,
      fileCount: partial ? 4 : 3,
      totalBytes: partial ? 10 : 3,
    });
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(secondPage).toMatchObject({
      entries: [expect.objectContaining({ id: "entry-a", available: "unchecked" })],
      hasMore: false,
      nextCursor: null,
      total: 3,
    });
    expect(availabilityResponse.json().result.data.entries).toEqual([
      expect.objectContaining({ id: "entry-c", available: partial ? "partial" : "unavailable" }),
      expect.objectContaining({ id: "entry-b", available: "available" }),
    ]);
    expect(availabilityResponse.json().result.data.entries[0].fileRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          available: false,
          availabilityError: expect.stringContaining("File missing; media library record retained only"),
        }),
      ]),
    );
  });

  it("collects deduplicated actor profiles from crawler payloads and tolerates unusable ones", async () => {
    const root = await createTempRoot("actor-profile-root");
    const { fastify, services } = await createTestServer();
    const token = await loginAsAdmin(fastify);
    const { rootId } = await createTestLibrary(fastify, token, root);
    const state = await services.persistence.getState();

    expect(await services.library.listActorProfiles()).toEqual([]);

    for (const [id, crawlerDataJson] of [
      ["profile-a", JSON.stringify({ actor_profiles: [{ name: "Alice", birth_place: "Tokyo" }] })],
      // Same actor under different casing/padding, plus one the first payload never mentioned.
      ["profile-b", JSON.stringify({ actor_profiles: [{ name: " alice ", birth_place: "Osaka" }, { name: "Bob" }] })],
      // Neither of these may take the whole collection down.
      ["profile-broken", "{ not json"],
      ["profile-empty-name", JSON.stringify({ actor_profiles: [{ name: "  " }] })],
    ] as const) {
      await state.repositories.library.upsertEntry({
        movie: { id, number: id, crawlerDataJson, createdAt: new Date("2026-05-01T00:00:00.000Z") },
        files: [{ rootId, rootRelativePath: `${id}.mp4`, fileId: `${rootId}:${id}.mp4` }],
      });
    }

    // First occurrence wins, so Alice keeps Tokyo rather than Osaka.
    expect(await services.library.listActorProfiles()).toEqual([
      { name: "Alice", birth_place: "Tokyo" },
      { name: "Bob" },
    ]);
  });

  it("rejects root browser escape attempts", async () => {
    const root = await createTempRoot("browser-root");
    const { fastify } = await createTestServer();
    const token = await loginAsAdmin(fastify);
    const { rootId } = await createTestLibrary(fastify, token, root);

    const response = await fastify.inject({
      method: "GET",
      url: `/trpc/browser.list?input=${encodeURIComponent(JSON.stringify({ rootId, relativePath: ".." }))}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.message).toContain("escapes media root");
  });

  it("suggests server host directories through tRPC without returning files", async () => {
    const root = await createTempRoot("server-path-api");
    await mkdir(join(root, "Alpha"));
    await mkdir(join(root, "Beta"));
    await writeFile(join(root, "Alpha.txt"), "not a directory");
    const { fastify } = await createTestServer();
    const token = await loginAsAdmin(fastify);
    await createTestLibrary(fastify, token, root);

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

  it("authorizes automation endpoints with revocable API keys and scrapes a downloader's path", async () => {
    const root = await createTempRoot("automation-root");
    await writeFile(join(root, "ABC-123.mp4"), "video");
    const image = await startTestImageServer();
    const { fastify } = await createTestServer({ scrapeAggregation: createTestAggregation(`${image.url}/cover.png`) });
    const unauthorizedResponse = await fastify.inject({ method: "GET", url: "/api/automation/library/recent" });
    const token = await loginAsAdmin(fastify);
    await createTestLibrary(fastify, token, root, { placement: "hardlink", automation: "scrape" });
    const created = await fastify.inject({
      method: "POST",
      url: "/trpc/apiKeys.create",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "qBittorrent" },
    });
    const { key, secret } = created.json().result.data;
    const automation = { authorization: `Bearer ${secret}` };

    const startResponse = await fastify.inject({
      method: "POST",
      url: `/api/automation/scrape/start?path=${encodeURIComponent(join(root, "ABC-123.mp4"))}`,
      headers: automation,
    });
    const taskId = startResponse.json().task.id;
    await waitForScrapeRunStatus(fastify, token, taskId, "completed");
    // A second callback for a source the library already holds queues nothing and publishes no second version.
    const duplicateResponse = await fastify.inject({
      method: "POST",
      url: `/api/automation/scrape/start?path=${encodeURIComponent(join(root, "ABC-123.mp4"))}`,
      headers: automation,
    });
    expect(duplicateResponse.json()).toMatchObject({ task: null, webhook: null, duplicate: true });
    const recentResponse = await fastify.inject({
      method: "GET",
      url: "/api/automation/library/recent?limit=1",
      headers: automation,
    });
    const cloudDrive = await fastify.inject({
      method: "POST",
      url: "/api/webhooks/clouddrive",
      headers: automation,
      payload: {
        device_name: "nas",
        user_name: "user",
        version: "1",
        event_category: "file",
        event_name: "notify",
        data: [],
      },
    });
    // An API key reaches only the automation endpoints, and stops working once revoked.
    const keyOnSettings = await fastify.inject({ method: "GET", url: "/trpc/config.read", headers: automation });
    await fastify.inject({
      method: "POST",
      url: "/trpc/apiKeys.delete",
      headers: { authorization: `Bearer ${token}` },
      payload: { id: key.id },
    });
    const revoked = await fastify.inject({ method: "GET", url: "/api/automation/library/recent", headers: automation });

    expect(unauthorizedResponse.statusCode).toBe(401);
    expect(unauthorizedResponse.json().message).toContain("Authentication required");
    expect(startResponse.statusCode).toBe(200);
    expect(startResponse.json().webhook).toMatchObject({ taskId, kind: "scrape", errors: [] });
    expect(recentResponse.json().tasks[0]).toMatchObject({ taskId, kind: "scrape", status: "completed" });
    expect(recentResponse.json().tasks[0].completedAt).toEqual(expect.any(String));
    expect(cloudDrive.statusCode).toBe(204);
    expect(keyOnSettings.statusCode).toBe(401);
    expect(revoked.statusCode).toBe(401);
  });
  it("delivers outbound automation webhooks when task updates are published", async () => {
    const webhook = await startWebhookServer();
    const root = await createTempRoot("outbound-webhook-root");
    await writeFile(join(root, "ABC-123.mp4"), "video");
    const image = await startTestImageServer();
    const { fastify } = await createTestServer({
      automationWebhook: { secret: "test-secret", url: webhook.url },
      scrapeAggregation: createTestAggregation(`${image.url}/cover.png`),
    });
    const token = await loginAsAdmin(fastify);
    await createTestLibrary(fastify, token, root);

    const startResponse = await fastify.inject({
      method: "POST",
      url: "/api/automation/scrape/start",
      headers: { authorization: `Bearer ${token}` },
      payload: { path: root },
    });
    const taskId = startResponse.json().task.id;
    await waitForScrapeRunStatus(fastify, token, taskId, "completed");

    await expect
      .poll(async () => {
        const response = await fastify.inject({
          method: "GET",
          url: "/api/automation/webhooks/status",
          headers: { authorization: `Bearer ${token}` },
        });
        return response.json().webhook.delivered;
      })
      .toBe(1);
    const statusResponse = await fastify.inject({
      method: "GET",
      url: "/api/automation/webhooks/status",
      headers: { authorization: `Bearer ${token}` },
    });

    // Scrape runs report their outcome once, when they finish.
    expect(webhook.deliveries).toEqual([
      expect.objectContaining({
        body: expect.objectContaining({ taskId, kind: "scrape", status: "completed" }),
        secret: "test-secret",
      }),
    ]);
    expect(statusResponse.json().webhook).toMatchObject({ configured: true, delivered: 1, failed: 0 });

    await webhook.close();
  });
  it("resolves configured filename NFO paths and preserves unmanaged XML on edit", async () => {
    const root = await createTempRoot("nfo-editor-root");
    const { fastify, services } = await createTestServer();
    const token = await loginAsAdmin(fastify);
    const { rootId } = await createTestLibrary(fastify, token, root);
    await services.config.update({ download: { nfoNaming: "filename", nfoIgnoreFields: ["director"] } });
    await writeFile(join(root, "ABC-123.mp4"), "video");
    await writeFile(
      join(root, "ABC-123.nfo"),
      '<?xml version="1.0"?><movie custom="keep"><title>Old</title><originaltitle>Old</originaltitle><uniqueid type="javdb" default="true">ABC-123</uniqueid><actor role="lead"><name>Actor A</name><thumb>actor.jpg</thumb></actor><providerid source="local">keep-me</providerid></movie>',
    );

    const readInput = { rootId, relativePath: "movie.nfo", videoRelativePath: "ABC-123.mp4" };
    const readResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/scrape.nfoRead?input=${encodeURIComponent(JSON.stringify(readInput))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const readResult = readResponse.json().result.data;
    expect(readResponse.statusCode).toBe(200);
    expect(readResult.effectiveRelativePath).toBe("ABC-123.nfo");
    expect(readResult.data.actors).toEqual(["Actor A"]);

    const writeResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.nfoWrite",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...readInput,
        relativePath: readResult.effectiveRelativePath,
        data: { ...readResult.data, title: "New", title_zh: "New", director: "Omitted Director" },
      },
    });
    const savedXml = await readFile(join(root, "ABC-123.nfo"), "utf8");
    expect(writeResponse.statusCode).toBe(200);
    expect(writeResponse.json().result.data.effectiveRelativePath).toBe("ABC-123.nfo");
    expect(savedXml).toContain("<title>New</title>");
    expect(savedXml).not.toContain("<director>Omitted Director</director>");
    expect(savedXml).toContain('<movie custom="keep">');
    expect(savedXml).toContain('<actor role="lead">');
    expect(savedXml).toContain('<providerid source="local">keep-me</providerid>');
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

  it("streams task updates through the SSE endpoint", async () => {
    const { fastify, services } = await createTestServer();
    const token = await loginAsAdmin(fastify);
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

    const readyEvent = formatSseEvent({ kind: "invalidate", resources: ["ready"] });
    const preamble = await readStreamUntil(reader, readyEvent);
    expect(preamble).toContain(": connected\n\n");
    // No `id:` field: the stream has no replay, so a reconnect resyncs via the `ready` invalidation.
    expect(preamble).not.toMatch(/^id:/mu);
    const listenerCountWithSse = services.taskEvents.listenerCount();

    services.taskEvents.invalidate("scan");

    const scanEvent = formatSseEvent({ kind: "invalidate", resources: ["scan"] });
    expect(await readStreamUntil(reader, scanEvent)).toBe(scanEvent);

    await reader.cancel();
    abortController.abort();

    await expect.poll(() => services.taskEvents.listenerCount()).toBe(listenerCountWithSse - 1);
  });
});

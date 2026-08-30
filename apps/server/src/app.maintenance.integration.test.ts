import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MaintenanceRuntime } from "@mdcz/runtime/maintenance";
import type { AggregationService } from "@mdcz/runtime/scrape";
import { FileOrganizer, NfoGenerator } from "@mdcz/runtime/scrape";
import { Website } from "@mdcz/shared/enums";
import type { MaintenanceActiveSessionSnapshot } from "@mdcz/shared/maintenanceTasks";
import type { CrawlerData, MaintenancePresetId } from "@mdcz/shared/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeTestServers,
  createTempRoot,
  createTestAggregation,
  createTestPngBytes,
  createTestServer,
  loginAsAdmin,
  startTestImageServer,
  syncMediaRootFromConfig,
} from "./app.testSupport";
import type { ServerConfigService } from "./services/configService";

type TestFastify = Awaited<ReturnType<typeof createTestServer>>["fastify"];

const writeMaintenanceInput = async (root: string, number: string, title: string): Promise<void> => {
  await writeFile(join(root, `${number}.mp4`), "video");
  await writeFile(
    join(root, `${number}.nfo`),
    new NfoGenerator().buildXml({
      title,
      number,
      actors: ["Actor M"],
      genres: ["Drama"],
      scene_images: [],
      website: Website.JAVDB,
    }),
  );
};

const configureOrganizedOutput = async (
  fastify: TestFastify,
  token: string,
  root: string,
  extra: Record<string, unknown> = {},
): Promise<void> => {
  await fastify.inject({
    method: "POST",
    url: "/trpc/config.update",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      paths: { mediaPath: root, successOutputFolder: "JAV_output" },
      behavior: { successFileMove: true, successFileRename: true },
      naming: { folderTemplate: "{number}", fileTemplate: "{number}" },
      ...extra,
    },
  });
};

const startMaintenancePreview = async (
  fastify: TestFastify,
  token: string,
  rootId: string,
  presetId: MaintenancePresetId,
) => {
  const startResponse = await fastify.inject({
    method: "POST",
    url: "/trpc/maintenance.start",
    headers: { authorization: `Bearer ${token}` },
    payload: { rootId, presetId },
  });
  expect(startResponse.statusCode).toBe(200);
  const sessionId = startResponse.json().result.data.sessionId as string;
  const session = await waitForMaintenanceSession(fastify, token, sessionId, "preview", "completed");
  return { session, sessionId };
};

const readMaintenanceSession = async (fastify: TestFastify, token: string) => {
  const response = await fastify.inject({
    method: "GET",
    url: "/trpc/maintenance.getActiveSession",
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.statusCode).toBe(200);
  return response.json().result.data as MaintenanceActiveSessionSnapshot | null;
};

const waitForMaintenanceSession = async (
  fastify: TestFastify,
  token: string,
  sessionId: string,
  phase: "preview" | "apply",
  status: "paused" | "completed",
): Promise<MaintenanceActiveSessionSnapshot> => {
  let session: MaintenanceActiveSessionSnapshot | null = null;
  await expect
    .poll(async () => {
      session = await readMaintenanceSession(fastify, token);
      return session?.id === sessionId ? `${session.phase}:${session.status}` : null;
    })
    .toBe(`${phase}:${status}`);
  if (!session) throw new Error(`Maintenance session disappeared: ${sessionId}`);
  return session;
};

const createMaintenanceRuntime = (
  config: ServerConfigService,
  aggregationService: AggregationService,
): MaintenanceRuntime =>
  new MaintenanceRuntime({
    actorImageService: {
      prepareActorProfilesForMovie: async () => undefined,
    } as never,
    aggregationService,
    config,
    downloadManager: {
      downloadAll: async () => undefined,
    } as never,
    fileOrganizer: new FileOrganizer(),
    nfoGenerator: new NfoGenerator(),
    signalService: {
      setProgress: () => undefined,
      showLogText: () => undefined,
    },
    translateService: {
      translateCrawlerData: async (data: CrawlerData) => data,
    } as never,
  });

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

describe("buildServer maintenance integration", () => {
  it("creates exactly one preview per selected ref", async () => {
    const root = await createTempRoot("maintenance-two-selected-root");
    await writeMaintenanceInput(root, "ABC-201", "Local Title ABC-201");
    await writeMaintenanceInput(root, "ABC-202", "Local Title ABC-202");
    await writeMaintenanceInput(root, "ABC-203", "Local Title ABC-203");
    const { fastify } = await createTestServer();
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, root);
    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/maintenance.start",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        rootId,
        presetId: "organize_files",
        refs: ["ABC-201.mp4", "ABC-203.mp4"].map((relativePath) => ({ rootId, relativePath })),
      },
    });
    const sessionId = startResponse.json().result.data.sessionId as string;
    const session = await waitForMaintenanceSession(fastify, token, sessionId, "preview", "completed");
    expect(session.previews.map((item) => item.relativePath)).toEqual(["ABC-201.mp4", "ABC-203.mp4"]);
  });

  it("pauses an in-flight preview and resumes only the pending selected ref", async () => {
    const root = await createTempRoot("maintenance-pause-resume-root");
    await writeMaintenanceInput(root, "ABC-211", "Local Title ABC-211");
    await writeMaintenanceInput(root, "ABC-212", "Local Title ABC-212");
    let firstCallStarted!: () => void;
    let releaseFirstCall!: () => void;
    const started = new Promise<void>((resolve) => {
      firstCallStarted = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releaseFirstCall = resolve;
    });
    const previewedPaths: string[] = [];
    const { fastify } = await createTestServer({
      createMaintenanceRuntime: (config) => {
        const runtime = createMaintenanceRuntime(
          config,
          createTestAggregation("https://example.com/maintenance.png") as AggregationService,
        );
        const previewEntries = runtime.previewEntries.bind(runtime);
        runtime.previewEntries = async (input) => {
          previewedPaths.push(input.entries[0]?.ref.relativePath ?? input.entries[0]?.fileInfo.fileName ?? "");
          if (previewedPaths.length === 1) {
            firstCallStarted();
            await blocked;
          }
          return await previewEntries(input);
        };
        return runtime;
      },
    });
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, root);
    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/maintenance.start",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        rootId,
        presetId: "organize_files",
        refs: ["ABC-211.mp4", "ABC-212.mp4"].map((relativePath) => ({ rootId, relativePath })),
      },
    });
    const sessionId = startResponse.json().result.data.sessionId as string;
    await started;
    const pauseResponsePromise = fastify.inject({
      method: "POST",
      url: "/trpc/maintenance.pause",
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId },
    });
    await waitForMaintenanceSession(fastify, token, sessionId, "preview", "paused");
    releaseFirstCall();
    const pauseResponse = await pauseResponsePromise;
    expect(pauseResponse.statusCode).toBe(200);
    expect(previewedPaths).toEqual(["ABC-211.mp4"]);

    const resumeResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/maintenance.resume",
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId },
    });
    expect(resumeResponse.statusCode).toBe(200);
    const completed = await waitForMaintenanceSession(fastify, token, sessionId, "preview", "completed");
    const items = completed.previews;
    expect(items.map((item) => item.relativePath)).toEqual(["ABC-211.mp4", "ABC-212.mp4"]);
    expect(new Set(items.map((item) => item.id)).size).toBe(2);
    expect(previewedPaths).toEqual(["ABC-211.mp4", "ABC-212.mp4"]);
  });

  it("starts a read_local preview from selected files", async () => {
    const root = await createTempRoot("maintenance-selected-root");
    await writeMaintenanceInput(root, "ABC-225", "Local Title ABC-225");
    const { fastify } = await createTestServer();
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, root);

    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/maintenance.start",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        rootId,
        presetId: "read_local",
        refs: [{ rootId, relativePath: "ABC-225.mp4" }],
      },
    });
    expect(startResponse.statusCode).toBe(200);
    const sessionId = startResponse.json().result.data.sessionId as string;
    const session = await waitForMaintenanceSession(fastify, token, sessionId, "preview", "completed");

    expect(session.previews).toHaveLength(1);
    expect(session.previews[0]).toMatchObject({
      relativePath: "ABC-225.mp4",
      proposedCrawlerData: { number: "ABC-225", title: "Local Title ABC-225" },
    });
  });

  it("runs organize_files preview and apply through the authoritative session", async () => {
    const root = await createTempRoot("maintenance-organize-root");
    await writeMaintenanceInput(root, "ABC-125", "Local Title ABC-125");
    const { fastify } = await createTestServer();
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, root);

    await configureOrganizedOutput(fastify, token, root);
    const { session, sessionId } = await startMaintenancePreview(fastify, token, rootId, "organize_files");
    const applyResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/maintenance.execute",
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, confirmationToken: `maintenance:${sessionId}` },
    });
    const appliedSession = await waitForMaintenanceSession(fastify, token, sessionId, "apply", "completed");
    const libraryResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/library.list",
      headers: { authorization: `Bearer ${token}` },
      payload: { query: "ABC-125", limit: 20 },
    });
    expect(session.previews[0]).toMatchObject({
      presetId: "organize_files",
      relativePath: "ABC-125.mp4",
      status: "ready",
      proposedCrawlerData: { number: "ABC-125", title: "Local Title ABC-125" },
    });
    expect(applyResponse.statusCode).toBe(200);
    expect(applyResponse.json().result.data).toEqual({ sessionId });
    expect(appliedSession.currentBatch?.items[0]).toMatchObject({ status: "success" });
    expect(libraryResponse.json().result.data.entries[0]).toMatchObject({
      number: "ABC-125",
      title: "Local Title ABC-125",
    });
    const organizedVideo = join(root, "JAV_output", "ABC-125", "ABC-125.mp4");
    const organizedNfo = join(root, "JAV_output", "ABC-125", "ABC-125.nfo");
    await expect(access(organizedVideo)).resolves.toBeUndefined();
    await expect(access(organizedNfo)).resolves.toBeUndefined();
    await expect(access(join(root, "ABC-125.mp4"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rebuilds all offline with fake aggregation and organizes output", async () => {
    const root = await createTempRoot("maintenance-rebuild-root");
    await writeMaintenanceInput(root, "ABC-300", "Stale Local Title");
    await writeFile(join(root, "ABC-300-poster.jpg"), createTestPngBytes());

    const imageServer = await startTestImageServer();
    const aggregation = createTestAggregation(`${imageServer.url}/image.png`, {
      titlePrefix: "Remote Title",
      titleZhPrefix: "远程标题",
      director: "Remote Director",
      trailerUrl: "https://example.com/maintenance-trailer.mp4",
      trailerSourceUrl: "https://example.com/maintenance-trailer-source.mp4",
    }) as AggregationService;
    const { fastify } = await createTestServer({
      createMaintenanceRuntime: (config) => createMaintenanceRuntime(config, aggregation),
    });
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, root);

    await configureOrganizedOutput(fastify, token, root, {
      download: {
        generateNfo: true,
        downloadSceneImages: false,
        downloadTrailer: false,
        nfoIgnoreFields: ["director"],
      },
      translate: { enableTranslation: false },
    });
    const { session, sessionId } = await startMaintenancePreview(fastify, token, rootId, "rebuild_all");
    expect(session.previews[0]).toMatchObject({
      presetId: "rebuild_all",
      relativePath: "ABC-300.mp4",
      status: "ready",
      proposedCrawlerData: { number: "ABC-300", title: "Remote Title ABC-300" },
    });
    expect(session.previews[0].pathDiff).toBeTruthy();

    const applyResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/maintenance.execute",
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, confirmationToken: `maintenance:${sessionId}` },
    });
    expect(applyResponse.statusCode).toBe(200);
    expect(applyResponse.json().result.data).toEqual({ sessionId });
    const appliedSession = await waitForMaintenanceSession(fastify, token, sessionId, "apply", "completed");
    expect(appliedSession.currentBatch?.items[0]).toMatchObject({ status: "success" });

    const organizedVideo = join(root, "JAV_output", "ABC-300", "ABC-300.mp4");
    const organizedNfo = join(root, "JAV_output", "ABC-300", "ABC-300.nfo");
    await expect(access(organizedVideo)).resolves.toBeUndefined();
    const organizedNfoContent = await readFile(organizedNfo, "utf8");
    expect(organizedNfoContent).toContain("Remote Title ABC-300");
    expect(organizedNfoContent).not.toContain("<director>Remote Director</director>");
    expect(organizedNfoContent).not.toContain("<trailer>");
    expect(organizedNfoContent).not.toContain("trailer_source_url");
    expect(organizedNfoContent).not.toContain("scene_images");
    await expect(access(join(root, "ABC-300.mp4"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps refresh_data on the source path", async () => {
    const root = await createTempRoot("maintenance-override-root");
    await writeMaintenanceInput(root, "ABC-400", "Local Title ABC-400");

    const imageServer = await startTestImageServer();
    const aggregation = createTestAggregation(`${imageServer.url}/image.png`, {
      titlePrefix: "Remote Title",
      titleZhPrefix: "远程标题",
    }) as AggregationService;
    const { fastify } = await createTestServer({
      createMaintenanceRuntime: (config) => createMaintenanceRuntime(config, aggregation),
    });
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, root);

    await configureOrganizedOutput(fastify, token, root, {
      translate: { enableTranslation: false },
      download: { downloadSceneImages: false, downloadTrailer: false },
    });
    const { session } = await startMaintenancePreview(fastify, token, rootId, "refresh_data");
    expect(session.previews[0].pathDiff).toBeFalsy();
  });
});

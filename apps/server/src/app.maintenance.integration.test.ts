import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MaintenanceRuntime } from "@mdcz/runtime/maintenance";
import type { AggregationService } from "@mdcz/runtime/scrape";
import { FileOrganizer, NfoGenerator } from "@mdcz/runtime/scrape";
import { Website } from "@mdcz/shared/enums";
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
  waitForTaskStatus,
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
  const taskId = startResponse.json().result.data.id as string;
  await waitForTaskStatus(fastify, token, taskId, "completed");
  const previewResponse = await fastify.inject({
    method: "GET",
    url: `/trpc/maintenance.preview?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(previewResponse.statusCode).toBe(200);
  return { preview: previewResponse.json().result.data, taskId };
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
  it("scans selected maintenance files through read_local semantics without preview or execute", async () => {
    const root = await createTempRoot("maintenance-selected-root");
    await writeMaintenanceInput(root, "ABC-225", "Local Title ABC-225");
    const { fastify } = await createTestServer();
    const token = await loginAsAdmin(fastify);
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

  it("runs organize_files preview and apply through task-backed logs with filesystem moves", async () => {
    const root = await createTempRoot("maintenance-organize-root");
    await writeMaintenanceInput(root, "ABC-125", "Local Title ABC-125");
    const { fastify } = await createTestServer();
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, root);

    await configureOrganizedOutput(fastify, token, root);
    const { preview, taskId } = await startMaintenancePreview(fastify, token, rootId, "organize_files");
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

    expect(preview.items[0]).toMatchObject({
      presetId: "organize_files",
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
      title: "Local Title ABC-125",
    });
    expect(logsResponse.json().result.data.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "task", message: expect.stringContaining("Maintenance") }),
      ]),
    );

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
    const { preview, taskId } = await startMaintenancePreview(fastify, token, rootId, "rebuild_all");
    expect(preview.items[0]).toMatchObject({
      presetId: "rebuild_all",
      relativePath: "ABC-300.mp4",
      status: "ready",
      proposedCrawlerData: { number: "ABC-300", title: "Remote Title ABC-300" },
    });
    expect(preview.items[0].pathDiff).toBeTruthy();

    const applyResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/maintenance.execute",
      headers: { authorization: `Bearer ${token}` },
      payload: { taskId, confirmationToken: preview.confirmationToken },
    });
    expect(applyResponse.statusCode).toBe(200);
    expect(applyResponse.json().result.data.applied[0]).toMatchObject({
      relativePath: "ABC-300.mp4",
      status: "success",
    });

    const organizedVideo = join(root, "JAV_output", "ABC-300", "ABC-300.mp4");
    const organizedNfo = join(root, "JAV_output", "ABC-300", "ABC-300.nfo");
    await expect(access(organizedVideo)).resolves.toBeUndefined();
    const organizedNfoContent = await readFile(organizedNfo, "utf8");
    expect(organizedNfoContent).toContain("Remote Title ABC-300");
    expect(organizedNfoContent).not.toContain("<director>Remote Director</director>");
    expect(organizedNfoContent).toContain("<trailer>");
    expect(organizedNfoContent).toContain("trailer_source_url");
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
    const { preview } = await startMaintenancePreview(fastify, token, rootId, "refresh_data");
    expect(preview.items[0].pathDiff).toBeFalsy();
  });
});

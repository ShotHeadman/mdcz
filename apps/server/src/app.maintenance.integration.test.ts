import { access, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { MaintenanceRuntime } from "@mdcz/runtime/maintenance";
import type { AggregationResult, AggregationService } from "@mdcz/runtime/scrape";
import { FileOrganizer, NfoGenerator } from "@mdcz/runtime/scrape";
import type { Configuration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeTestServers,
  createTempRoot,
  createTestServer,
  loginAsAdmin,
  startLocalHttpServer,
  syncMediaRootFromConfig,
  waitForTaskStatus,
} from "./app.testSupport";
import type { ServerConfigService } from "./services/configService";

const createPngBytes = (): Buffer => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mP8z8BQDwAFgwJ/lUOh9QAAAABJRU5ErkJggg==",
    "base64",
  );
  return Buffer.concat([png, Buffer.alloc(9000)]);
};

const startImageServer = async (): Promise<{ url: string; close: () => Promise<void> }> => {
  const server = await startLocalHttpServer((_request, response) => {
    response.writeHead(200, { "content-type": "image/png" });
    response.end(createPngBytes());
  });
  return {
    url: `${server.url}/image.png`,
    close: server.close,
  };
};

const createFakeAggregation = (imageUrl: string): AggregationService =>
  ({
    async aggregate(number: string, _configuration: Configuration): Promise<AggregationResult> {
      return {
        data: {
          title: `Remote Title ${number}`,
          title_zh: `远程标题 ${number}`,
          number,
          actors: ["Actor A"],
          genres: ["Drama"],
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
  }) as AggregationService;

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
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, root);

    await fastify.inject({
      method: "POST",
      url: "/trpc/config.update",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        paths: {
          mediaPath: root,
          successOutputFolder: "JAV_output",
        },
        behavior: {
          successFileMove: true,
          successFileRename: true,
        },
        naming: {
          folderTemplate: "{number}",
          fileTemplate: "{number}",
        },
      },
    });

    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/maintenance.start",
      headers: { authorization: `Bearer ${token}` },
      payload: { rootId, presetId: "organize_files" },
    });
    expect(startResponse.statusCode).toBe(200);
    const taskId = startResponse.json().result.data.id as string;

    await waitForTaskStatus(fastify, token, taskId, "completed");

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
    const nfoGenerator = new NfoGenerator();
    await writeFile(join(root, "ABC-300.mp4"), "video");
    await writeFile(
      join(root, "ABC-300.nfo"),
      nfoGenerator.buildXml({
        title: "Stale Local Title",
        number: "ABC-300",
        actors: ["Actor Old"],
        genres: ["Drama"],
        scene_images: [],
        website: Website.JAVDB,
      }),
    );
    await writeFile(join(root, "ABC-300-poster.jpg"), createPngBytes());

    const imageServer = await startImageServer();
    try {
      const aggregation = createFakeAggregation(imageServer.url);
      const { fastify } = await createTestServer({
        createMaintenanceRuntime: (config) => createMaintenanceRuntime(config, aggregation),
      });
      const token = await loginAsAdmin(fastify);
      const rootId = await syncMediaRootFromConfig(fastify, token, root);

      await fastify.inject({
        method: "POST",
        url: "/trpc/config.update",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          paths: {
            mediaPath: root,
            successOutputFolder: "JAV_output",
          },
          behavior: {
            successFileMove: true,
            successFileRename: true,
          },
          naming: {
            folderTemplate: "{number}",
            fileTemplate: "{number}",
          },
          download: {
            generateNfo: true,
            downloadSceneImages: false,
            downloadTrailer: false,
          },
          translate: {
            enableTranslation: false,
          },
        },
      });

      const startResponse = await fastify.inject({
        method: "POST",
        url: "/trpc/maintenance.start",
        headers: { authorization: `Bearer ${token}` },
        payload: { rootId, presetId: "rebuild_all" },
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
      const preview = previewResponse.json().result.data;
      expect(preview.items[0]).toMatchObject({
        presetId: "rebuild_all",
        relativePath: "ABC-300.mp4",
        status: "ready",
        proposedCrawlerData: {
          number: "ABC-300",
          title: "Remote Title ABC-300",
        },
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
      const nfoContent = await readFile(organizedNfo, "utf8");
      expect(nfoContent).toContain("Remote Title ABC-300");
      expect(nfoContent).toContain("<originaltitle>Remote Title ABC-300</originaltitle>");
      await expect(access(join(root, "ABC-300.mp4"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await imageServer.close();
    }
  });

  it("keeps refresh_data source path while rebuild_all plans organize moves", async () => {
    const root = await createTempRoot("maintenance-override-root");
    const nfoGenerator = new NfoGenerator();
    await writeFile(join(root, "ABC-400.mp4"), "video");
    await writeFile(
      join(root, "ABC-400.nfo"),
      nfoGenerator.buildXml({
        title: "Local Title ABC-400",
        number: "ABC-400",
        actors: ["Actor M"],
        genres: ["Drama"],
        scene_images: [],
        website: Website.JAVDB,
      }),
    );

    const imageServer = await startImageServer();
    try {
      const aggregation = createFakeAggregation(imageServer.url);
      const { fastify } = await createTestServer({
        createMaintenanceRuntime: (config) => createMaintenanceRuntime(config, aggregation),
      });
      const token = await loginAsAdmin(fastify);
      const rootId = await syncMediaRootFromConfig(fastify, token, root);

      await fastify.inject({
        method: "POST",
        url: "/trpc/config.update",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          paths: {
            mediaPath: root,
            successOutputFolder: "JAV_output",
          },
          behavior: {
            successFileMove: true,
            successFileRename: true,
          },
          naming: {
            folderTemplate: "{number}",
            fileTemplate: "{number}",
          },
          translate: {
            enableTranslation: false,
          },
          download: {
            downloadSceneImages: false,
            downloadTrailer: false,
          },
        },
      });

      const refreshStart = await fastify.inject({
        method: "POST",
        url: "/trpc/maintenance.start",
        headers: { authorization: `Bearer ${token}` },
        payload: { rootId, presetId: "refresh_data" },
      });
      const refreshTaskId = refreshStart.json().result.data.id as string;
      await waitForTaskStatus(fastify, token, refreshTaskId, "completed");
      const refreshPreview = await fastify.inject({
        method: "GET",
        url: `/trpc/maintenance.preview?input=${encodeURIComponent(JSON.stringify({ taskId: refreshTaskId }))}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(refreshPreview.json().result.data.items[0].pathDiff).toBeFalsy();

      const rebuildStart = await fastify.inject({
        method: "POST",
        url: "/trpc/maintenance.start",
        headers: { authorization: `Bearer ${token}` },
        payload: { rootId, presetId: "rebuild_all" },
      });
      const rebuildTaskId = rebuildStart.json().result.data.id as string;
      await waitForTaskStatus(fastify, token, rebuildTaskId, "completed");
      const rebuildPreview = await fastify.inject({
        method: "GET",
        url: `/trpc/maintenance.preview?input=${encodeURIComponent(JSON.stringify({ taskId: rebuildTaskId }))}`,
        headers: { authorization: `Bearer ${token}` },
      });
      const pathDiff = rebuildPreview.json().result.data.items[0].pathDiff as {
        currentVideoPath?: string;
        targetVideoPath?: string;
      } | null;
      expect(pathDiff).toBeTruthy();
      expect(basename(pathDiff?.currentVideoPath ?? "")).toBe("ABC-400.mp4");
      expect(pathDiff?.targetVideoPath).toContain("JAV_output");
      expect(pathDiff?.targetVideoPath).toContain("ABC-400");
    } finally {
      await imageServer.close();
    }
  });
});

import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MaintenanceRuntime } from "@mdcz/runtime/maintenance";
import { NetworkClient } from "@mdcz/runtime/network";
import type { AggregationService } from "@mdcz/runtime/scrape";
import { DownloadManager, FileOrganizer, MemoryImageHostCooldownStore, NfoGenerator } from "@mdcz/runtime/scrape";
import { Website } from "@mdcz/shared/enums";
import type { MaintenanceActiveSessionSnapshot } from "@mdcz/shared/maintenanceTasks";
import type { CrawlerData, MaintenancePresetId } from "@mdcz/shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  relativePaths: string[],
  outputRelativeDirectory = "JAV_output",
) => {
  const startResponse = await fastify.inject({
    method: "POST",
    url: "/trpc/maintenance.start",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      rootId,
      presetId,
      outputRootId: rootId,
      outputRelativeDirectory,
      refs: relativePaths.map((relativePath) => ({ rootId, relativePath })),
    },
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
  status: "paused" | "completed" | "failed",
): Promise<MaintenanceActiveSessionSnapshot> => {
  let session: MaintenanceActiveSessionSnapshot | null = null;
  await expect
    .poll(async () => {
      session = await readMaintenanceSession(fastify, token);
      return session?.id === sessionId ? session : null;
    })
    .toMatchObject({ phase, status });
  if (!session) throw new Error(`Maintenance session disappeared: ${sessionId}`);
  return session;
};

const createMaintenanceRuntime = (
  config: ServerConfigService,
  aggregationService: AggregationService,
  downloadAll: DownloadManager["downloadAll"] = async () => ({ sceneImages: [], downloaded: [] }),
): MaintenanceRuntime =>
  new MaintenanceRuntime({
    actorImageService: {
      prepareActorProfilesForMovie: async () => undefined,
    } as never,
    aggregationService,
    config,
    downloadManager: {
      downloadAll,
    } as never,
    fileOrganizer: new FileOrganizer(),
    nfoGenerator: new NfoGenerator(),
    signalService: {
      setProgress: () => undefined,
      showLogText: () => undefined,
    },
    translateService: {
      translateCrawlerData: async (data: CrawlerData) => ({ data, error: null }),
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
  it.each([
    "files",
    "missing",
  ] as const)("discovers directory scopes inside the accepted maintenance session (%s)", async (kind) => {
    const directory = await createTempRoot("maintenance-directory");
    const source = join(directory, "source");
    if (kind !== "missing") await mkdir(source);
    if (kind === "files") await writeMaintenanceInput(source, "ABC-123", "Local movie");
    const { fastify, services } = await createTestServer();
    const token = await loginAsAdmin(fastify);
    const response = await fastify.inject({
      method: "POST",
      url: "/trpc/maintenance.start",
      headers: { authorization: `Bearer ${token}` },
      payload: { source: { kind: "directory", scanDir: source, recursive: true }, presetId: "inspect_local" },
    });
    expect(response.statusCode).toBe(200);
    const sessionId = response.json().result.data.sessionId;
    await expect
      .poll(async () => (await services.maintenance.getActiveSession())?.status)
      .toBe(kind === "missing" ? "failed" : "completed");
    const session = await services.maintenance.getActiveSession();
    expect(session).toMatchObject({
      id: sessionId,
      phase: "preview",
      totalEntries: kind === "missing" ? null : 1,
      directoryScope: { scanDir: source, recursive: true },
    });
    expect(session?.refs.map((ref) => ref.relativePath)).toEqual(kind === "files" ? ["ABC-123.mp4"] : []);
  });
  it("creates exactly one preview per selected ref", async () => {
    const root = await createTempRoot("maintenance-two-selected-root");
    await writeMaintenanceInput(root, "ABC-201", "Local Title ABC-201");
    await writeMaintenanceInput(root, "ABC-202", "Local Title ABC-202");
    await writeMaintenanceInput(root, "ABC-203", "Local Title ABC-203");
    const { fastify } = await createTestServer();
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, root);
    const emptySelection = await fastify.inject({
      method: "POST",
      url: "/trpc/maintenance.start",
      headers: { authorization: `Bearer ${token}` },
      payload: { rootId, presetId: "local_organize", refs: [] },
    });
    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/maintenance.start",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        rootId,
        presetId: "local_organize",
        refs: ["ABC-201.mp4", "ABC-203.mp4"].map((relativePath) => ({ rootId, relativePath })),
      },
    });
    const sessionId = startResponse.json().result.data.sessionId as string;
    const session = await waitForMaintenanceSession(fastify, token, sessionId, "preview", "completed");
    expect(emptySelection.statusCode).toBe(400);
    expect(session.previews.map((item) => item.relativePath)).toEqual(["ABC-201.mp4", "ABC-203.mp4"]);
  });

  it("exposes paused and resumed previews through HTTP", async () => {
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
    let firstPreview = true;
    const { fastify } = await createTestServer({
      createMaintenanceRuntime: (config) => {
        const runtime = createMaintenanceRuntime(
          config,
          createTestAggregation("https://example.com/maintenance.png") as AggregationService,
        );
        const createSession = runtime.createSession.bind(runtime);
        runtime.createSession = async (sessionInput) => {
          const sessionRuntime = await createSession(sessionInput);
          const previewMovie = sessionRuntime.previewMovie.bind(sessionRuntime);
          sessionRuntime.previewMovie = async (input) => {
            if (firstPreview) {
              firstPreview = false;
              firstCallStarted();
              await blocked;
            }
            return await previewMovie(input);
          };
          return sessionRuntime;
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
        presetId: "local_organize",
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

    const resumeResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/maintenance.resume",
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId },
    });
    expect(resumeResponse.statusCode).toBe(200);
    const completed = await waitForMaintenanceSession(fastify, token, sessionId, "preview", "completed");
    expect(completed.previews.map((item) => item.relativePath)).toEqual(["ABC-211.mp4", "ABC-212.mp4"]);
  });

  it("starts a inspect_local preview from selected files", async () => {
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
        presetId: "inspect_local",
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

  it.each([
    "incoming",
    "organized",
    "nested-root",
  ] as const)("reorganizes the selected layout and preserves named assets (%s)", async (location) => {
    const parent = await createTempRoot("maintenance-organize-root");
    const root = location === "nested-root" ? join(parent, "JAV_output") : parent;
    const sourceRelative =
      location === "incoming" ? "" : location === "organized" ? "JAV_output/Old/ABC-125" : "Old/ABC-125";
    const sourceDir = join(root, sourceRelative);
    const metadataRoot = location === "nested-root" ? await createTempRoot("maintenance-metadata") : undefined;
    const sourceMetadataDir = sourceDir;
    const outputRelative = location === "nested-root" ? "" : "JAV_output";
    await mkdir(sourceDir, { recursive: true });
    await mkdir(sourceMetadataDir, { recursive: true });
    await writeFile(join(sourceDir, "ABC-125.mp4"), "video");
    await writeFile(join(sourceDir, "ABC-125.en.srt"), "subtitle");
    await writeFile(join(sourceMetadataDir, "ABC-125-poster.jpg"), "original poster");
    await writeFile(
      join(sourceMetadataDir, "ABC-125.nfo"),
      new NfoGenerator().buildXml(
        {
          number: "ABC-125",
          title: "Local Title ABC-125",
          studio: "S",
          actors: [],
          genres: [],
          scene_images: [],
          website: Website.JAVDB,
        },
        { assets: { poster: "ABC-125-poster.jpg", sceneImages: [], downloaded: [] } },
      ),
    );
    const { fastify } = await createTestServer();
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, root);

    await configureOrganizedOutput(fastify, token, root, {
      paths: { mediaPath: root, metadataPath: metadataRoot ?? "", successOutputFolder: "ignored-output" },
      naming: { folderTemplate: "{studio}/{number}", fileTemplate: "{number}_new", assetNamingMode: "followVideo" },
      download: { nfoNaming: "filename" },
    });
    const relativePath = join(sourceRelative, "ABC-125.mp4").replaceAll("\\", "/");
    const { session, sessionId } = await startMaintenancePreview(
      fastify,
      token,
      rootId,
      "local_organize",
      [relativePath],
      outputRelative,
    );
    await fastify.inject({
      method: "POST",
      url: "/trpc/config.update",
      headers: { authorization: `Bearer ${token}` },
      payload: { naming: { fileTemplate: "{number}_unexpected" } },
    });
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
      presetId: "local_organize",
      relativePath,
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
    const targetDir = join(root, outputRelative, "S", "ABC-125");
    const targetMetadataDir = targetDir;
    const organizedVideo = join(targetDir, "ABC-125_new.mp4");
    const organizedNfo = join(targetMetadataDir, "ABC-125_new.nfo");
    await expect(access(organizedVideo)).resolves.toBeUndefined();
    await expect(access(organizedNfo)).resolves.toBeUndefined();
    await expect(readFile(join(targetDir, "ABC-125_new.en.srt"), "utf8")).resolves.toBe("subtitle");
    await expect(readFile(join(targetMetadataDir, "ABC-125_new-poster.jpg"), "utf8")).resolves.toBe("original poster");
    expect(await readFile(organizedNfo, "utf8")).toContain("ABC-125_new-poster.jpg");
    await expect(access(join(sourceDir, "ABC-125.en.srt"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(sourceDir, "ABC-125.mp4"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(sourceMetadataDir, "ABC-125-poster.jpg"))).resolves.toBeUndefined();
  });

  it.each([
    "single",
    "multipart",
    "missing",
    "added",
    "metadata-changed",
    "conflict",
    "offline",
    "rollback",
  ] as const)("publishes the complete movie or preserves all files (%s)", async (scenario) => {
    const multipart = scenario !== "single";
    const root = await createTempRoot("maintenance-rebuild-root");
    await writeMaintenanceInput(root, "ABC-300", "Stale Local Title");
    const sourceNames = multipart ? ["ABC-300-CD1.mp4", "ABC-300-CD2.mp4"] : ["ABC-300.mp4"];
    if (multipart) {
      await rename(join(root, "ABC-300.mp4"), join(root, sourceNames[0]));
      await writeFile(join(root, sourceNames[1]), "second video");
    }
    await writeFile(join(root, "ABC-300-poster.jpg"), createTestPngBytes());

    const imageServer = await startTestImageServer();
    const aggregation = createTestAggregation(`${imageServer.url}/image.png`, {
      titlePrefix: "Remote Title",
      titleZhPrefix: "远程标题",
    }) as AggregationService;
    const aggregate = vi.spyOn(aggregation, "aggregate");
    const downloadAll = vi.fn(async () => ({ sceneImages: [] as string[], downloaded: [] as string[] }));
    const { fastify, services } = await createTestServer({
      createMaintenanceRuntime: (config) => createMaintenanceRuntime(config, aggregation, downloadAll),
    });
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, root);

    await configureOrganizedOutput(fastify, token, root, {
      download: {
        generateNfo: true,
        downloadSceneImages: false,
        downloadTrailer: false,
      },
      translate: { enableTranslation: false },
    });
    const state = await services.persistence.getState();
    for (const name of sourceNames)
      await state.repositories.library.upsertEntry({
        movie: {
          id: "maintenance-movie",
          assets: [
            { kind: "nfo", uri: "ABC-300.nfo", rootId, relativePath: "ABC-300.nfo", published: true },
            { kind: "poster", uri: "ABC-300-poster.jpg", rootId, relativePath: "ABC-300-poster.jpg", published: true },
          ],
        },
        files: [{ fileId: `maintenance-file:${name}`, rootId, rootRelativePath: name, assets: [] }],
      });
    const { session, sessionId } = await startMaintenancePreview(
      fastify,
      token,
      rootId,
      "rebuild_all",
      sourceNames.slice(-1),
    );
    expect(session.previews).toHaveLength(1);
    expect(session.previews[0]).toMatchObject({
      presetId: "rebuild_all",
      relativePath: sourceNames[0],
      status: "ready",
      proposedCrawlerData: { number: "ABC-300", title: "Remote Title ABC-300" },
    });
    expect(session.previews[0].pathDiff).toBeTruthy();
    expect(session.previews[0].affectedFiles).toHaveLength(sourceNames.length);
    const before = await state.repositories.library.getEntryById("maintenance-movie");
    if (scenario === "missing") await rm(join(root, sourceNames[1]));
    if (scenario === "added") {
      await writeFile(join(root, "ABC-300-CD3.mp4"), "third video");
      await state.repositories.library.upsertEntry({
        movie: { id: before.id },
        files: [{ fileId: "new-file", rootId, rootRelativePath: "ABC-300-CD3.mp4" }],
      });
    }
    if (scenario === "metadata-changed")
      await writeFile(join(root, "ABC-300.nfo"), "<movie><title>Changed after approval</title></movie>");
    if (scenario === "conflict") {
      await mkdir(join(root, "JAV_output", "ABC-300"), { recursive: true });
      await writeFile(join(root, "JAV_output", "ABC-300", sourceNames[0]), "occupied");
    }
    if (scenario === "offline")
      await state.repositories.mediaRoots.upsert({
        ...(await state.repositories.mediaRoots.get(rootId)),
        hostPath: join(root, "offline"),
      });
    if (scenario === "rollback")
      vi.spyOn(state.repositories.library, "writeEntry").mockImplementation(() => {
        throw new Error("injected maintenance commit failure");
      });

    const applyResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/maintenance.execute",
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, confirmationToken: `maintenance:${sessionId}` },
    });
    if (scenario === "offline") {
      expect(applyResponse.statusCode).toBe(500);
      await expect(readFile(join(root, sourceNames[0]), "utf8")).resolves.toBeTruthy();
      return;
    }
    expect(applyResponse.statusCode).toBe(200);
    expect(applyResponse.json().result.data).toEqual({ sessionId });
    const failed = scenario !== "single" && scenario !== "multipart" && scenario !== "added";
    const appliedSession = await waitForMaintenanceSession(
      fastify,
      token,
      sessionId,
      "apply",
      failed ? "failed" : "completed",
    );
    if (failed) {
      expect(appliedSession.currentBatch?.items[0]).toMatchObject({
        status: scenario === "conflict" ? "skipped" : "failed",
      });
      await expect(readFile(join(root, sourceNames[0]), "utf8")).resolves.toBeTruthy();
      if (scenario === "conflict")
        await expect(readFile(join(root, "JAV_output", "ABC-300", sourceNames[0]), "utf8")).resolves.toBe("occupied");
      else
        await expect(access(join(root, "JAV_output", "ABC-300", sourceNames[0]))).rejects.toMatchObject({
          code: "ENOENT",
        });
      if (scenario === "rollback")
        expect((await state.repositories.library.getEntryById(before.id)).files).toEqual(before.files);
      return;
    }
    expect(appliedSession.currentBatch?.items[0]).toMatchObject({ status: "success" });

    const organizedNfo = join(root, "JAV_output", "ABC-300", "ABC-300.nfo");
    for (const name of sourceNames) {
      await expect(access(join(root, "JAV_output", "ABC-300", name))).resolves.toBeUndefined();
      await expect(access(join(root, name))).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(aggregate).toHaveBeenCalledOnce();
    expect(downloadAll).toHaveBeenCalledOnce();
    const refreshed = await state.repositories.library.getEntryById("maintenance-movie");
    expect(refreshed.files.map((file) => file.id).sort()).toEqual(
      [...sourceNames.map((name) => `maintenance-file:${name}`), ...(scenario === "added" ? ["new-file"] : [])].sort(),
    );
    const organizedNfoContent = await readFile(organizedNfo, "utf8");
    expect(organizedNfoContent).toContain("Remote Title ABC-300");
    await expect(access(join(root, "ABC-300.nfo"))).resolves.toBeUndefined();
  });

  it("refreshes mirrored metadata while preserving video names and kept artwork", async () => {
    const root = await createTempRoot("maintenance-override-root");
    const metadataRoot = await createTempRoot("maintenance-refresh-metadata");
    const baseName = "ABC-400_LocalName";
    await writeFile(join(root, `${baseName}.mp4`), "video");

    const posterPath = join(metadataRoot, `${baseName}-poster.jpg`);
    const posterBytes = createTestPngBytes();
    await writeFile(posterPath, posterBytes);

    const imageServer = await startTestImageServer();
    const imageUrl = `${imageServer.url}/image.png`;
    await writeFile(
      join(metadataRoot, `${baseName}.nfo`),
      new NfoGenerator().buildXml(
        {
          number: "ABC-400",
          title: "Local Title ABC-400",
          actors: [],
          genres: [],
          scene_images: [],
          website: Website.JAVDB,
          poster_source_url: imageUrl,
        },
        { assets: { poster: posterPath, sceneImages: [], downloaded: [] } },
      ),
    );
    const aggregation = createTestAggregation(`${imageServer.url}/image.png`, {
      titlePrefix: "Remote Title",
      titleZhPrefix: "远程标题",
    }) as AggregationService;
    const network = new NetworkClient();
    const download = vi.spyOn(network, "download");
    const manager = new DownloadManager(network, { imageHostCooldownStore: new MemoryImageHostCooldownStore() });
    const { fastify, services } = await createTestServer({
      createMaintenanceRuntime: (config) =>
        createMaintenanceRuntime(config, aggregation, manager.downloadAll.bind(manager)),
    });
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, root);

    await configureOrganizedOutput(fastify, token, root, {
      paths: { mediaPath: root, metadataPath: metadataRoot },
      naming: { folderTemplate: "{number}", fileTemplate: "{number}_Changed", assetNamingMode: "followVideo" },
      translate: { enableTranslation: false },
      download: {
        downloadThumb: false,
        downloadFanart: false,
        downloadPoster: true,
        downloadSceneImages: false,
        downloadTrailer: false,
        nfoNaming: "filename",
      },
    });
    const state = await services.persistence.getState();
    const outputRoot = await services.mediaRoots.ensurePathRecord({ hostPath: metadataRoot });
    await state.repositories.library.upsertEntry({
      movie: {
        assets: [
          {
            kind: "nfo",
            uri: `${baseName}.nfo`,
            rootId: outputRoot.id,
            relativePath: `${baseName}.nfo`,
            published: true,
          },
          {
            kind: "poster",
            uri: `${baseName}-poster.jpg`,
            rootId: outputRoot.id,
            relativePath: `${baseName}-poster.jpg`,
            published: true,
          },
        ],
      },
      files: [
        {
          rootId,
          rootRelativePath: `${baseName}.mp4`,
          assets: [],
          fileId: `${rootId}:${baseName}.mp4`,
        },
      ],
    });
    const { session, sessionId } = await startMaintenancePreview(fastify, token, rootId, "refresh_metadata", [
      `${baseName}.mp4`,
    ]);
    expect(session.previews[0].pathDiff).toBeFalsy();
    expect(session.previews[0].fieldDiffs).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "title", oldValue: "Local Title ABC-400" })]),
    );
    const applied = await fastify.inject({
      method: "POST",
      url: "/trpc/maintenance.execute",
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, confirmationToken: `maintenance:${sessionId}` },
    });
    expect(applied.statusCode).toBe(200);
    await waitForMaintenanceSession(fastify, token, sessionId, "apply", "completed");
    await expect(readFile(posterPath)).resolves.toEqual(posterBytes);
    await expect(readFile(join(root, `${baseName}.mp4`), "utf8")).resolves.toBe("video");
    expect(await readFile(join(metadataRoot, `${baseName}.nfo`), "utf8")).toContain("Remote Title ABC-400");
    expect(download).not.toHaveBeenCalled();
  });
});

import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type AggregationResult, DownloadManager, PosterWatermarkService } from "@mdcz/runtime/scrape";
import { Website } from "@mdcz/shared/enums";
import sharp from "sharp";
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
  waitForScrapeRunStatus,
} from "./app.testSupport";
import type { ScrapeServiceResources } from "./services/scrapeService";

const createAmbiguousUncensoredAggregation = (
  imageUrl: string,
): NonNullable<ScrapeServiceResources["aggregationService"]> => ({
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
        rejectedSites: [],
        totalElapsedMs: 1,
      },
    };
  },
});

const createGatedAggregation = (
  imageUrl: string,
): {
  aggregation: NonNullable<ScrapeServiceResources["aggregationService"]>;
  aggregatedNumbers: string[];
  firstCallStarted: Promise<void>;
  releaseFirstCall: () => void;
} => {
  const inner = createTestAggregation(imageUrl);
  const aggregatedNumbers: string[] = [];
  let resolveStarted!: () => void;
  let releaseFirstCall!: () => void;
  const firstCallStarted = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    releaseFirstCall = resolve;
  });

  return {
    aggregatedNumbers,
    firstCallStarted,
    releaseFirstCall: () => {
      releaseFirstCall();
    },
    aggregation: {
      async aggregate(number, configuration, signal, manualScrape): Promise<AggregationResult> {
        const isFirstCall = aggregatedNumbers.length === 0;
        aggregatedNumbers.push(number);
        if (isFirstCall) {
          resolveStarted();
          await gate;
        }
        return await inner.aggregate(number, configuration, signal, manualScrape);
      },
    },
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

describe("buildServer scrape integration", () => {
  it.each([
    "files",
    "empty",
    "missing",
  ] as const)("accepts a directory scope and completes discovery in the backend (%s)", async (kind) => {
    const root = await createTempRoot("directory-task");
    const source = join(root, "source");
    const targetDir = join(root, "output");
    if (kind !== "missing") await mkdir(source);
    if (kind === "files") {
      await mkdir(join(source, "nested"));
      await writeFile(join(source, "nested", "ABC-123.mp4"), "video");
      await writeFile(join(source, "nested", "trailer.mp4"), "sidecar");
    }
    const { fastify, services } = await createTestServer({
      scrapeAggregation: createTestAggregation("https://unused.example/image.png"),
    });
    await services.config.update({
      download: {
        downloadThumb: false,
        downloadPoster: false,
        downloadFanart: false,
        downloadSceneImages: false,
        downloadTrailer: false,
      },
    });
    const token = await loginAsAdmin(fastify);
    const accepted = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.start",
      headers: { authorization: `Bearer ${token}` },
      payload: { executionMode: "batch", source: { kind: "directory", scanDir: source, recursive: true }, targetDir },
    });
    expect(accepted.statusCode).toBe(200);
    const taskId = accepted.json().result.data.runId;
    await waitForScrapeRunStatus(fastify, token, taskId, kind === "missing" ? "failed" : "completed");
    const snapshot = await services.scrape.snapshot({ taskId });
    expect(snapshot.directorySource).toMatchObject({ scanDir: source, recursive: true });
    expect(snapshot.task.totalItems).toBe(kind === "missing" ? null : kind === "files" ? 1 : 0);
    const manifest = await (await services.persistence.getState()).repositories.scrapeRuns.get(taskId);
    expect(manifest.items.map((item) => item.relativePath)).toEqual(kind === "files" ? ["nested/ABC-123.mp4"] : []);
    expect(manifest.manifestFixedAt === null).toBe(kind === "missing");
    if (kind !== "files") expect(manifest.items).toEqual([]);
    if (kind === "missing") {
      const retry = await fastify.inject({
        method: "POST",
        url: "/trpc/scrape.retry",
        headers: { authorization: `Bearer ${token}` },
        payload: { taskId },
      });
      expect(retry.statusCode).not.toBe(200);
      expect(retry.body).toContain("目录文件列表尚未生成，无法重试，请重新扫描目录");
      await mkdir(source);
      await writeFile(join(source, "DEF-456.mp4"), "new video");
      const rerun = await fastify.inject({
        method: "POST",
        url: "/trpc/scrape.rerunDirectory",
        headers: { authorization: `Bearer ${token}` },
        payload: { taskId },
      });
      expect(rerun.statusCode).toBe(200);
      const rerunId = rerun.json().result.data.runId;
      expect(rerunId).not.toBe(taskId);
      await waitForScrapeRunStatus(fastify, token, rerunId, "completed");
      const repository = (await services.persistence.getState()).repositories.scrapeRuns;
      expect((await repository.get(rerunId)).items.map((item) => item.relativePath)).toEqual(["DEF-456.mp4"]);
      expect(await repository.get(taskId)).toEqual(manifest);
    }
  });
  it.each([
    "conflict",
    "metadata",
  ] as const)("prepares the whole selection and isolates failures according to their scope (%s)", async (failure) => {
    const root = await createTempRoot("scrape-preflight-root");
    const numbers = ["XYZ-111", "ABF-981", "XYZ-222", "XYZ-333"];
    const files = new Map<string, string>();
    for (const number of numbers) {
      files.set(join(root, `${number}.mp4`), `source ${number}`);
    }
    for (const number of failure === "conflict" ? ["ABF-981", "XYZ-222"] : [])
      for (const suffix of [".mp4", ".nfo", "-poster.jpg"])
        files.set(join(root, `JAV_output/fixed/${number}/${number}${suffix}`), `existing ${number}${suffix}`);
    for (const [file, content] of files) {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, content);
    }
    const aggregation = createTestAggregation("https://unused.example/image.png");
    const aggregateOriginal = aggregation.aggregate.bind(aggregation);
    const aggregate = vi.spyOn(aggregation, "aggregate");
    aggregate.mockImplementation(async (...args) => {
      if (failure === "metadata" && args[0] === "ABF-981") throw new Error("Metadata failure");
      return await aggregateOriginal(...args);
    });
    const { fastify, services } = await createTestServer({ scrapeAggregation: aggregation });
    await services.config.update({
      naming: { folderTemplate: "fixed/{number}", fileTemplate: "{number}" },
      download: {
        downloadThumb: false,
        downloadPoster: false,
        downloadFanart: false,
        downloadSceneImages: false,
        downloadTrailer: false,
      },
    });
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, root);
    const state = await services.persistence.getState();
    const entry = await state.repositories.library.upsertEntry({
      movie: { title: "Original title", number: "ABF-981" },
      files: [
        {
          rootId,
          rootRelativePath: "JAV_output/fixed/ABF-981/ABF-981.mp4",
          fileId: `${rootId}:JAV_output/fixed/ABF-981/ABF-981.mp4`,
        },
      ],
    });
    const response = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.start",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        executionMode: "batch",
        refs: numbers.map((number) => ({ rootId, relativePath: `${number}.mp4` })),
        outputRootId: rootId,
        outputRelativeDirectory: "JAV_output",
      },
    });
    expect(response.statusCode).toBe(200);
    const taskId = response.json().result.data.runId;
    await waitForScrapeRunStatus(fastify, token, taskId, "failed");
    const terminal = await services.scrape.snapshot({ taskId });
    if (failure === "metadata") {
      expect(terminal.task).toMatchObject({ status: "failed", failedCount: 1, skippedCount: 0, successCount: 3 });
      expect(aggregate).toHaveBeenCalledTimes(4);
      for (const number of ["XYZ-111", "XYZ-222", "XYZ-333"]) {
        expect(await readFile(join(root, `JAV_output/fixed/${number}/${number}.mp4`), "utf8")).toBe(`source ${number}`);
      }
      expect(await readFile(join(root, "ABF-981.mp4"), "utf8")).toBe("source ABF-981");
      return;
    }
    expect(terminal.task).toMatchObject({ status: "failed", failedCount: 2, skippedCount: 0, successCount: 2 });
    expect(terminal.task.error).toContain("目标目录已存在同名影片");
    for (const number of ["ABF-981", "XYZ-222"])
      expect(terminal.task.error).toContain(join(root, `JAV_output/fixed/${number}/${number}.mp4`));
    expect(aggregate).toHaveBeenCalledTimes(4);
    expect((await services.scrape.liveRuns()).runs).toEqual([]);
    expect((await services.scrape.history({ taskId })).runs).toHaveLength(1);
    expect(await state.repositories.library.getEntryById(entry.id)).toEqual(entry);
    for (const number of ["ABF-981", "XYZ-222"]) {
      expect(terminal.items.find((item) => item.relativePath === `${number}.mp4`)?.error).toBe(
        `目标目录已存在同名影片\n待处理：${join(root, `${number}.mp4`)}\n目标路径：${join(root, `JAV_output/fixed/${number}/${number}.mp4`)}`,
      );
      expect(await readFile(join(root, `${number}.mp4`), "utf8")).toBe(`source ${number}`);
      expect(await readFile(join(root, `JAV_output/fixed/${number}/${number}.mp4`), "utf8")).toBe(
        `existing ${number}.mp4`,
      );
    }
    for (const number of ["XYZ-111", "XYZ-333"]) {
      await expect(stat(join(root, `${number}.mp4`))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(join(root, `JAV_output/fixed/${number}/${number}.mp4`), "utf8")).toBe(`source ${number}`);
    }
  });

  it("runs the full scrape runtime pipeline and indexes organized output", async () => {
    const root = await createTempRoot("scrape-runtime-root");
    const actorRoot = await createTempRoot("actor-root");
    const actorPhotoPath = join(actorRoot, "Actor A.jpg");
    await writeFile(join(root, "ABC-123.mp4"), "video");
    await writeFile(actorPhotoPath, createTestPngBytes());
    const imageServer = await startTestImageServer();
    const { fastify, services } = await createTestServer({
      scrapeAggregation: createTestAggregation(`${imageServer.url}/image.png`, {
        actorPhotoPath,
        director: "Runtime Director",
        trailerUrl: "https://example.com/runtime-trailer.mp4",
        trailerSourceUrl: "https://example.com/runtime-trailer-source.mp4",
      }),
    });
    const taskEvents: unknown[] = [];
    const unsubscribeTaskEvents = services.taskEvents.subscribe((event) => {
      taskEvents.push(event);
    });
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, root);
    await fastify.inject({
      method: "POST",
      url: "/trpc/config.update",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        download: { downloadSceneImages: false, downloadTrailer: false, nfoIgnoreFields: ["director"] },
        paths: { actorPhotoFolder: actorRoot },
      },
    });

    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.start",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        executionMode: "batch",
        refs: [{ rootId, relativePath: "ABC-123.mp4" }],
        outputRootId: rootId,
        outputRelativeDirectory: "JAV_output",
      },
    });
    const taskId = startResponse.json().result.data.runId;
    expect(startResponse.json().result.data).toEqual({ runId: taskId });

    await waitForScrapeRunStatus(fastify, token, taskId, "completed");

    const scrapeHistoryResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/scrape.history?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const scrapeResult = scrapeHistoryResponse.json().result.data.results[0];
    const liveRuns = await services.scrape.liveRuns();
    expect(liveRuns.runs).toEqual([]);
    const terminalResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/scrape.snapshot?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(terminalResponse.statusCode).toBe(200);
    expect(terminalResponse.json().result.data).toMatchObject({
      task: { id: taskId, status: "completed", continuity: "final", successCount: 1, error: null },
      progress: { percent: 100 },
      items: [
        expect.objectContaining({
          resultId: scrapeResult.id,
          status: "success",
          crawlerData: scrapeResult.crawlerData,
          assets: expect.arrayContaining([expect.objectContaining({ kind: "poster", type: "local" })]),
        }),
      ],
    });
    expect(scrapeHistoryResponse.json().result.data.runs[0].executionMode).toBe("batch");
    const scrapeResultId = scrapeResult.id;
    const cropSessionResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/scrape.posterCropSession?input=${encodeURIComponent(JSON.stringify({ id: scrapeResultId }))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const cropSession = cropSessionResponse.json().result.data;
    const cropSaveResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.posterCropSave",
      headers: { authorization: `Bearer ${token}` },
      payload: { id: scrapeResultId, crop: cropSession.initialCrop },
    });

    const libraryResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/library.list",
      headers: { authorization: `Bearer ${token}` },
      payload: { query: "ABC-123", limit: 20 },
    });
    const entry = libraryResponse.json().result.data.entries[0];
    const availabilityResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/library.availability",
      headers: { authorization: `Bearer ${token}` },
      payload: { ids: [entry.id] },
    });
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
    expect(cropSessionResponse.statusCode).toBe(200);
    expect(cropSession.sourceRelativePath).toBe("JAV_output/Actor A/ABC-123/thumb.png");
    expect(cropSession.targetRelativePath).toBe("JAV_output/Actor A/ABC-123/poster.png");
    expect(cropSaveResponse.statusCode).toBe(200);
    expect(cropSaveResponse.json().result.data.revision).toEqual(expect.any(String));
    expect(libraryResponse.json().result.data.total).toBe(1);
    expect(entry).toMatchObject({
      actors: ["Actor A"],
      available: "unchecked",
      mediaIdentity: "ABC-123",
      number: "ABC-123",
      fileRefs: [
        expect.objectContaining({ fileName: "ABC-123.mp4", rootId, rootDisplayName: root.split(/[\\/]+/u).at(-1) }),
      ],
    });
    expect(entry.fileRefs.find((file: { id: string }) => file.id === entry.displayFileId)?.relativePath).toBe(
      outputRelativePath,
    );
    expect(availabilityResponse.statusCode).toBe(200);
    expect(availabilityResponse.json().result.data.entries[0]).toMatchObject({
      id: entry.id,
      available: "available",
      fileRefs: [expect.objectContaining({ available: true })],
    });
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
    expect(scrapeResult.assets).toEqual(
      expect.arrayContaining([
        { type: "local", kind: "poster", file: { rootId, relativePath: "JAV_output/Actor A/ABC-123/poster.png" } },
        { type: "local", kind: "thumb", file: { rootId, relativePath: "JAV_output/Actor A/ABC-123/thumb.png" } },
      ]),
    );
    // `downloadTrailer: false` skips writing the file and the NFO entry, but the source site's URL
    // still reaches the detail view as a remote ref.
    expect(scrapeResult.assets).toContainEqual({
      type: "remote",
      kind: "trailer",
      url: "https://example.com/runtime-trailer-source.mp4",
    });
    expect(nfoContent).toContain("Runtime Title ABC-123");
    expect(nfoContent).toContain(".actors/Actor A.jpg");
    expect(nfoContent).not.toContain("<director>Runtime Director</director>");
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
    expect(taskEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "invalidate", resources: expect.arrayContaining(["scrape-history"]) }),
      ]),
    );
    unsubscribeTaskEvents();
  });

  it("publishes STRM and subtitles into an explicit nested output directory", async () => {
    const root = await createTempRoot("scrape-explicit-output-root");
    const outputPath = join(root, "custom-output");
    const sourcePath = join(root, "ABC-456.strm");
    await writeFile(sourcePath, "\uFEFF#KODIPROP:test=value\r\n ./real.mp4 \r\n");
    await writeFile(join(root, "real.mp4"), "video");
    await writeFile(join(root, "ABC-456.zh.srt"), "subtitle");
    await mkdir(outputPath);
    const imageServer = await startTestImageServer();
    const { fastify, services } = await createTestServer({
      scrapeAggregation: createTestAggregation(`${imageServer.url}/image.png`),
    });
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, root);
    const outputRoot = await services.mediaRoots.ensurePath({ hostPath: outputPath });
    await fastify.inject({
      method: "POST",
      url: "/trpc/config.update",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        paths: { successOutputFolder: "legacy-output" },
        download: { downloadSceneImages: false, downloadTrailer: false },
      },
    });

    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.start",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        executionMode: "batch",
        refs: [{ rootId, relativePath: "ABC-456.strm" }],
        outputRootId: outputRoot.id,
        outputRelativeDirectory: outputRoot.relativeDirectory,
      },
    });
    const taskId = startResponse.json().result.data.runId;
    await waitForScrapeRunStatus(fastify, token, taskId, "completed");

    const historyResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/scrape.history?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const result = historyResponse.json().result.data.results[0];
    expect(outputRoot.id).toBe(rootId);
    expect(outputRoot.relativeDirectory).toBe("custom-output");
    expect(result.outputRootId).toBe(rootId);
    expect(result.outputRelativePath).toMatch(/^custom-output\/Actor A\//u);
    expect(result.outputRelativePath.endsWith(".strm")).toBe(true);
    await expect(readFile(join(root, result.outputRelativePath), "utf8")).resolves.toBe(
      `\uFEFF#KODIPROP:test=value\r\n ${join(root, "real.mp4")} \r\n`,
    );
    await expect(readFile(join(root, result.outputRelativePath.replace(/\.[^.]+$/u, ".zh.srt")), "utf8")).resolves.toBe(
      "subtitle",
    );
    await expect(readFile(sourcePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(root, "ABC-456.zh.srt"))).rejects.toMatchObject({ code: "ENOENT" });

    const nfoPath = join(root, result.nfoRelativePath);
    await writeFile(nfoPath, "<movie><title>Old title</title></movie>");
    await services.config.update({
      download: { keepNfo: false },
      behavior: { successFileMove: false, successFileRename: false },
    });
    const rescrape = await services.scrape.start({
      executionMode: "single",
      refs: [{ rootId, relativePath: result.outputRelativePath }],
    });
    await waitForScrapeRunStatus(fastify, token, rescrape.task.id, "completed");
    const refreshed = await services.scrape.snapshot({ taskId: rescrape.task.id });
    expect(refreshed.task.status).toBe("completed");
    expect(await readFile(nfoPath, "utf8")).not.toContain("Old title");
  });

  it("applies configured poster tag badges with the same runtime rendering used by desktop", async () => {
    const root = await createTempRoot("scrape-runtime-watermark");
    await writeFile(join(root, "ABC-123.mp4"), "video");
    const sourcePoster = Buffer.concat([
      await sharp({
        create: {
          width: 400,
          height: 600,
          channels: 3,
          background: { r: 240, g: 240, b: 240 },
        },
      })
        .png()
        .toBuffer(),
      Buffer.alloc(9000),
    ]);
    const imageServer = await startTestImageServer(sourcePoster);
    const { fastify } = await createTestServer({
      scrapeAggregation: createTestAggregation(`${imageServer.url}/image.png`),
    });
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, root);
    await fastify.inject({
      method: "POST",
      url: "/trpc/config.update",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        download: {
          downloadSceneImages: false,
          downloadTrailer: false,
          tagBadges: true,
          tagBadgeTypes: ["censored"],
          tagBadgePosition: "bottomRight",
        },
      },
    });

    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.start",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        executionMode: "batch",
        refs: [{ rootId, relativePath: "ABC-123.mp4" }],
        outputRootId: rootId,
        outputRelativeDirectory: "JAV_output",
      },
    });
    await waitForScrapeRunStatus(fastify, token, startResponse.json().result.data.runId, "completed");

    const expectedPosterPath = join(root, "expected-poster.png");
    await writeFile(expectedPosterPath, sourcePoster);
    await new PosterWatermarkService({ dataDir: root }).applyTagBadges(
      expectedPosterPath,
      [
        {
          id: "censored",
          label: "有码",
          colorStart: "#0F766E",
          colorEnd: "#115E59",
          accentColor: "#CCFBF1",
        },
      ],
      "bottomRight",
    );

    const serverPoster = await readFile(join(root, "JAV_output/Actor A/ABC-123/poster.png"));
    const expectedPoster = await readFile(expectedPosterPath);
    const [serverPixels, expectedPixels, sourcePixels] = await Promise.all([
      sharp(serverPoster).raw().toBuffer(),
      sharp(expectedPoster).raw().toBuffer(),
      sharp(sourcePoster).raw().toBuffer(),
    ]);
    expect(serverPixels.equals(sourcePixels)).toBe(false);
    expect(serverPixels).toEqual(expectedPixels);
  });

  it.each([true, false])("serves independent metadata and retains registered outputs (move=%s)", async (move) => {
    const mediaRoot = await createTempRoot("separate-metadata-media");
    const metadataRoot = await createTempRoot("separate-metadata-local");
    const nextMetadataRoot = await createTempRoot("separate-metadata-local-next");
    await writeFile(join(mediaRoot, "ABC-123.mp4"), "video");
    await writeFile(join(mediaRoot, "ABC-123.en.forced.srt"), "subtitle");
    await writeFile(join(mediaRoot, "poster.jpg"), "source poster");
    const imageServer = await startTestImageServer();
    const { fastify, services } = await createTestServer({
      scrapeAggregation: createTestAggregation(`${imageServer.url}/image.png`),
    });
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, mediaRoot);
    await fastify.inject({
      method: "POST",
      url: "/trpc/config.update",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        download: { downloadSceneImages: false, downloadTrailer: false },
        paths: { metadataPath: metadataRoot },
        behavior: { metadataOnly: true, successFileMove: move, successFileRename: move, generateStrm: true },
        naming: { fileTemplate: "{number}_output" },
      },
    });

    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.start",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        executionMode: "batch",
        refs: [{ rootId, relativePath: "ABC-123.mp4" }],
        outputRootId: rootId,
        outputRelativeDirectory: "JAV_output",
      },
    });
    const taskId = startResponse.json().result.data.runId;
    await waitForScrapeRunStatus(fastify, token, taskId, "completed");

    const historyResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/scrape.history?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const result = historyResponse.json().result.data.results[0];
    const directory = "Actor A/ABC-123";
    const outputRelativePath = "ABC-123.mp4";
    const nfoRelativePath = `${directory}/ABC-123_output.nfo`;
    const strmRelativePath = `${directory}/ABC-123_output.strm`;
    const posterRelativePath = `${directory}/poster.png`;

    expect(result).toMatchObject({
      rootId,
      outputRelativePath,
      nfoRelativePath,
      nfoRootId: expect.any(String),
      status: "success",
    });
    expect(result.nfoRootId).not.toBe(rootId);
    await expect(readFile(join(mediaRoot, outputRelativePath), "utf8")).resolves.toBe("video");
    await expect(readFile(join(mediaRoot, nfoRelativePath), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(metadataRoot, nfoRelativePath), "utf8")).resolves.toContain("Runtime Title ABC-123");
    await expect(readFile(join(metadataRoot, strmRelativePath), "utf8")).resolves.toBe(
      join(mediaRoot, outputRelativePath),
    );
    const posterContent = await readFile(join(metadataRoot, posterRelativePath));
    expect([...posterContent.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    const rootsResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/mediaRoots.list",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(rootsResponse.json().result.data.roots.map((root: { id: string }) => root.id)).toContain(result.nfoRootId);
    await fastify.inject({
      method: "POST",
      url: "/trpc/config.update",
      headers: { authorization: `Bearer ${token}` },
      payload: { paths: { metadataPath: nextMetadataRoot } },
    });
    const nextMetadataRootRecord = await fastify.inject({
      method: "POST",
      url: "/trpc/mediaRoots.ensurePath",
      headers: { authorization: `Bearer ${token}` },
      payload: { hostPath: nextMetadataRoot },
    });
    const rootsAfterMetadataChange = await fastify.inject({
      method: "GET",
      url: "/trpc/mediaRoots.list",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(nextMetadataRootRecord.json().result.data.id).not.toBe(result.nfoRootId);
    expect(rootsAfterMetadataChange.json().result.data.roots.map((root: { id: string }) => root.id)).toEqual(
      expect.arrayContaining([result.nfoRootId, nextMetadataRootRecord.json().result.data.id]),
    );

    const assetResponse = await fastify.inject({
      method: "GET",
      url: `/api/library/assets/${encodeURIComponent(result.nfoRootId)}/${encodeURI(posterRelativePath)}?token=${encodeURIComponent(token)}`,
    });
    expect(assetResponse.statusCode).toBe(200);

    const nfoResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/scrape.nfoRead?input=${encodeURIComponent(
        JSON.stringify({
          rootId: result.nfoRootId,
          relativePath: nfoRelativePath,
          videoRelativePath: outputRelativePath,
        }),
      )}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(nfoResponse.statusCode).toBe(200);
    expect(nfoResponse.json().result.data.data).toMatchObject({ number: "ABC-123" });
    const state = await services.persistence.getState();
    const entry = await state.repositories.library.getEntry(rootId, outputRelativePath);
    expect(entry.assets.map((asset) => asset.kind)).toEqual(
      expect.arrayContaining(["nfo", "strm", "subtitle", "poster"]),
    );
    await expect(readFile(join(metadataRoot, directory, "ABC-123_output.en.forced.srt"), "utf8")).resolves.toBe(
      "subtitle",
    );
    const edit = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.nfoWrite",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        rootId: result.nfoRootId,
        relativePath: nfoRelativePath,
        data: { ...nfoResponse.json().result.data.data, title: "Edited independent output" },
      },
    });
    expect(edit.statusCode).toBe(200);
    expect(await readFile(join(metadataRoot, nfoRelativePath), "utf8")).toContain("Edited independent output");
    const crop = await fastify.inject({
      method: "GET",
      url: `/trpc/scrape.posterCropSession?input=${encodeURIComponent(JSON.stringify({ id: result.id }))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(crop.statusCode).toBe(200);
    expect(crop.json().result.data.rootId).toBe(result.nfoRootId);
    const savedCrop = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.posterCropSave",
      headers: { authorization: `Bearer ${token}` },
      payload: { id: result.id, crop: crop.json().result.data.initialCrop },
    });
    expect(savedCrop.statusCode).toBe(200);
    const retainedPath = `${directory}/checksum.txt`;
    await writeFile(join(metadataRoot, retainedPath), "retained resource");
    await state.repositories.library.upsertEntry({
      movie: {
        ...entry,
        assets: [
          ...entry.assets.filter((asset) => asset.fileId === null),
          {
            kind: "checksum",
            uri: retainedPath,
            rootId: result.nfoRootId,
            relativePath: retainedPath,
            published: true,
          },
        ],
      },
      files: [
        {
          ...entry,
          fileId: entry.files[0].id,
          rootId: entry.files[0].rootId,
          rootRelativePath: entry.files[0].rootRelativePath,
          assets: entry.assets.filter((asset) => asset.fileId === entry.files[0].id),
        },
      ],
    });
    const manifest = await state.repositories.scrapeRuns.get(taskId);
    const confirmation = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.confirmUncensored",
      headers: { authorization: `Bearer ${token}` },
      payload: { taskId, items: [{ itemId: manifest.items[0].id, choice: "uncensored" }] },
    });
    expect(confirmation.statusCode, confirmation.body).toBe(200);
    const confirmed = await state.repositories.library.getEntryById(entry.id);
    expect(confirmed.assets.map((asset) => asset.kind)).toEqual(
      expect.arrayContaining(["nfo", "strm", "subtitle", "poster", "checksum"]),
    );
    const run = await state.repositories.scrapeRuns.get(taskId);
    const revised = run.items.find((item) => item.id === result.id);
    if (!revised) throw new Error("Confirmation outcome disappeared");
    expect(confirmed.assets).toContainEqual(
      expect.objectContaining({
        kind: "nfo",
        rootId: result.nfoRootId,
        relativePath: nfoRelativePath,
      }),
    );
    const localFiles = [
      { rootId: confirmed.files[0].rootId, relativePath: confirmed.files[0].rootRelativePath },
      ...confirmed.assets.flatMap((asset) =>
        asset.rootId && asset.relativePath ? [{ rootId: asset.rootId, relativePath: asset.relativePath }] : [],
      ),
    ];
    const retained = await Promise.all(
      localFiles.map(async (file) => {
        const path = join((await state.repositories.mediaRoots.get(file.rootId)).hostPath, file.relativePath);
        return { path, bytes: await readFile(path) };
      }),
    );
    const removal = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.removeRecord",
      headers: { authorization: `Bearer ${token}` },
      payload: { rootId: confirmed.files[0].rootId, relativePath: confirmed.files[0].rootRelativePath },
    });
    expect(removal.statusCode).toBe(200);
    await expect(state.repositories.library.getEntryById(entry.id)).rejects.toThrow("not found");
    for (const file of retained) expect(await readFile(file.path)).toEqual(file.bytes);
    expect(await readFile(join(mediaRoot, "poster.jpg"), "utf8")).toBe("source poster");
    if (!move) {
      expect(await readFile(join(mediaRoot, "ABC-123.mp4"), "utf8")).toBe("video");
      expect(await readFile(join(mediaRoot, "ABC-123.en.forced.srt"), "utf8")).toBe("subtitle");
    }
  });

  it("scrapes selected parts with one aggregation request and isolated item results", async () => {
    const root = await createTempRoot("selected-scrape-root");
    const names = ["ABC-128-CD1.mp4", "ABC-128-CD2.mp4"];
    for (const name of names) await writeFile(join(root, name), name);
    const imageServer = await startTestImageServer();
    const aggregation = createTestAggregation(`${imageServer.url}/image.png`);
    const downloadAll = vi.spyOn(DownloadManager.prototype, "downloadAll");
    const { fastify, services } = await createTestServer({
      scrapeAggregation: aggregation,
    });
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, root);

    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.start",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        executionMode: "batch",
        refs: names.map((relativePath) => ({ rootId, relativePath })),
        outputRootId: rootId,
        uncensoredConfirmed: true,
      },
    });

    expect(startResponse.statusCode).toBe(200);
    expect(startResponse.json().result.data).toEqual({ runId: expect.any(String) });
    const taskId = startResponse.json().result.data.runId;

    await expect
      .poll(async () => {
        const liveRunsResponse = await fastify.inject({
          method: "GET",
          url: "/trpc/scrape.liveRuns",
          headers: { authorization: `Bearer ${token}` },
        });
        return liveRunsResponse.json().result.data.runs[0];
      })
      .toMatchObject({
        task: { id: taskId, kind: "scrape" },
        items: names.map((relativePath) => expect.objectContaining({ rootId, relativePath })),
      });
    await waitForScrapeRunStatus(fastify, token, taskId, "completed");
    expect(downloadAll).toHaveBeenCalledOnce();
    const entries = await services.persistence
      .getState()
      .then(async (state) => await state.repositories.library.listEntries());
    expect(entries).toEqual([
      expect.objectContaining({
        mediaIdentity: "ABC-128",
        files: expect.arrayContaining([
          expect.objectContaining({ partNumber: 1, partSuffix: "-CD1" }),
          expect.objectContaining({ partNumber: 2, partSuffix: "-CD2" }),
        ]),
      }),
    ]);
  });

  it.each([
    "single",
    "multipart",
    "missing",
    "conflicting",
    "rollback",
  ] as const)("confirms every registered movie file atomically (%s)", async (scenario) => {
    const root = await createTempRoot("ambiguous-uncensored-root");
    const names = scenario === "single" ? ["ABP-999-U.mp4"] : ["ABP-999-U-CD1.mp4", "ABP-999-U-CD2.mp4"];
    for (const name of names) await writeFile(join(root, name), "video");
    const imageServer = await startTestImageServer();
    let aggregateCount = 0;
    const aggregation = createAmbiguousUncensoredAggregation(`${imageServer.url}/image.png`);
    const { fastify, services } = await createTestServer({
      scrapeAggregation: {
        async aggregate(...args) {
          aggregateCount += 1;
          if (aggregateCount > 1) throw new Error("confirmation must not scrape again");
          return await aggregation.aggregate(...args);
        },
      },
    });
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, root);
    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.start",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        executionMode: "batch",
        refs: names.map((relativePath) => ({ rootId, relativePath })),
        outputRootId: rootId,
      },
    });
    const taskId = startResponse.json().result.data.runId;

    await waitForScrapeRunStatus(fastify, token, taskId, "completed");
    const initialResults = await services.persistence.getState().then(async (state) => {
      const run = await state.repositories.scrapeRuns.get(taskId);
      return state.repositories.scrapeRuns.itemResults(run);
    });
    const initialResult = initialResults[0];
    expect(initialResult?.outputRelativePath).not.toBe(names[0]);
    await expect(readFile(join(root, names[0]))).rejects.toMatchObject({ code: "ENOENT" });
    const state = await services.persistence.getState();
    const originalEntry = await state.repositories.library.getEntryByRunItemId(initialResult.id);
    if (!originalEntry) throw new Error("Expected registered movie");

    const pendingConfirmationResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/scrape.pendingUncensoredConfirmation",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(pendingConfirmationResponse.json().result.data.items).toEqual(
      names.map((relativePath) => expect.objectContaining({ taskId, ref: { rootId, relativePath } })),
    );
    if (scenario === "missing") await rm(join(root, initialResults[1].outputRelativePath as string));
    if (scenario === "rollback")
      vi.spyOn(state.repositories.scrapeRuns, "reviseSuccess").mockImplementation(() => {
        throw new Error("injected confirmation failure");
      });

    const confirmResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.confirmUncensored",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        taskId,
        items: [
          { itemId: initialResult?.itemId ?? "", choice: "leak" },
          ...(scenario === "conflicting" ? [{ itemId: initialResults[1].itemId, choice: "uncensored" }] : []),
        ],
      },
    });

    if (scenario === "missing" || scenario === "conflicting" || scenario === "rollback") {
      expect(confirmResponse.statusCode).toBe(400);
      if (scenario === "missing") expect(confirmResponse.json().error.message).toContain("output files not found");
      expect(state.repositories.scrapeRuns.itemResults(await state.repositories.scrapeRuns.get(taskId))).toEqual(
        initialResults,
      );
      expect((await state.repositories.library.getEntryById(originalEntry.id)).files).toEqual(originalEntry.files);
      await expect(readFile(join(root, initialResult.outputRelativePath as string), "utf8")).resolves.toBe("video");
      return;
    }
    expect(confirmResponse.statusCode).toBe(200);
    expect(confirmResponse.json().result.data).toEqual({ runId: taskId });
    expect(aggregateCount).toBe(1);
    const confirmedHistoryResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/scrape.history?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const confirmedResult = confirmedHistoryResponse.json().result.data.results[0];
    expect(confirmedResult).toMatchObject({ status: "success", uncensoredAmbiguous: false });
    expect(confirmedHistoryResponse.json().result.data.results).toHaveLength(names.length);
    expect(
      confirmedHistoryResponse
        .json()
        .result.data.results.every((result: { uncensoredAmbiguous: boolean }) => !result.uncensoredAmbiguous),
    ).toBe(true);
    expect(
      (await state.repositories.library.getEntryById(originalEntry.id)).files.map((file) => file.id).sort(),
    ).toEqual(originalEntry.files.map((file) => file.id).sort());
    expect(confirmedResult.outputRelativePath).toContain("流出");
    await expect(readFile(join(root, confirmedResult.outputRelativePath))).resolves.toBeTruthy();

    const repeatedResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.confirmUncensored",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        taskId,
        items: [{ itemId: initialResult?.itemId ?? "", choice: "leak" }],
      },
    });
    expect(repeatedResponse.statusCode).toBe(200);
    expect(repeatedResponse.json().result.data).toEqual({ runId: taskId });
    expect(aggregateCount).toBe(1);
  });

  it("rejects uncensored confirmation items outside the task", async () => {
    const root = await createTempRoot("uncensored-invalid-root");
    const { fastify } = await createTestServer();
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, root);
    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.start",
      headers: { authorization: `Bearer ${token}` },
      payload: { executionMode: "batch", refs: [{ rootId, relativePath: "ABC-001.mp4" }], outputRootId: rootId },
    });
    const taskId = startResponse.json().result.data.runId;
    await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.stop",
      headers: { authorization: `Bearer ${token}` },
      payload: { taskId },
    });

    const confirmResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.confirmUncensored",
      headers: { authorization: `Bearer ${token}` },
      payload: { taskId, items: [{ itemId: "missing-item", choice: "uncensored" }] },
    });

    expect(confirmResponse.statusCode).toBe(400);
    expect(confirmResponse.json().error.message).toContain("Item does not belong to scrape task");
  });

  it("accepts scrape refs that span multiple registered media roots", async () => {
    const root = await createTempRoot("selected-scrape-root");
    const otherRoot = await createTempRoot("selected-scrape-other");
    await writeFile(join(root, "ABC-129.mp4"), "video");
    await writeFile(join(otherRoot, "ABC-130.mp4"), "video");
    const { fastify, services } = await createTestServer();
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, root);
    const otherRootId = await syncMediaRootFromConfig(fastify, token, otherRoot);

    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.start",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        executionMode: "batch",
        refs: [
          { rootId, relativePath: "ABC-129.mp4" },
          { rootId: otherRootId, relativePath: "ABC-130.mp4" },
        ],
        outputRootId: rootId,
        uncensoredConfirmed: true,
      },
    });

    expect(startResponse.statusCode).toBe(200);
    const manifest = await (await services.persistence.getState()).repositories.scrapeRuns.get(
      startResponse.json().result.data.runId,
    );
    expect(manifest.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rootId, relativePath: "ABC-129.mp4" }),
        expect.objectContaining({ rootId: otherRootId, relativePath: "ABC-130.mp4" }),
      ]),
    );
  });

  it("rejects scrape refs for an unregistered media root", async () => {
    const root = await createTempRoot("selected-unregistered-root");
    await writeFile(join(root, "ABC-130.mp4"), "video");
    const { fastify } = await createTestServer();
    const token = await loginAsAdmin(fastify);

    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.start",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        executionMode: "batch",
        refs: [{ rootId: "missing-root", relativePath: "ABC-130.mp4" }],
        outputRootId: "missing-root",
        uncensoredConfirmed: true,
      },
    });

    expect(startResponse.statusCode).toBe(500);
    expect(startResponse.json().error.message).toContain("Media root not found");
  });

  it("aborts an in-flight scrape item when the task is stopped", async () => {
    const root = await createTempRoot("scrape-stop-root");
    await writeFile(join(root, "ABC-124.mp4"), "video");
    const imageServer = await startTestImageServer();
    const control = createGatedAggregation(`${imageServer.url}/image.png`);
    const { fastify } = await createTestServer({ scrapeAggregation: control.aggregation });
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, root);

    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.start",
      headers: { authorization: `Bearer ${token}` },
      payload: { executionMode: "batch", refs: [{ rootId, relativePath: "ABC-124.mp4" }], outputRootId: rootId },
    });
    const taskId = startResponse.json().result.data.runId;
    await control.firstCallStarted;

    const stopping = fastify.inject({
      method: "POST",
      url: "/trpc/scrape.stop",
      headers: { authorization: `Bearer ${token}` },
      payload: { taskId },
    });
    control.releaseFirstCall();
    const stopResponse = await stopping;

    expect(stopResponse.statusCode).toBe(200);
    await waitForScrapeRunStatus(fastify, token, taskId, "stopped");

    const historyResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/scrape.history?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
      headers: { authorization: `Bearer ${token}` },
      payload: undefined,
    });
    expect(historyResponse.json().result.data.results[0]?.status).toBe("skipped");
  });

  it("reads manifest-only runs as interrupted history", async () => {
    const root = await createTempRoot("scrape-interrupted-root");
    const { fastify, services } = await createTestServer();
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, root);
    const state = await services.persistence.getState();
    const manifest = await state.repositories.scrapeRuns.create({
      id: "interrupted-run",
      rootId,
      executionMode: "batch",
      createdAt: new Date(1_700_000_000_000),
      items: [
        { id: "interrupted-item", ordinal: 0, rootId, relativePath: "ABC-126.mp4" },
        { id: "failed-item", ordinal: 1, rootId, relativePath: "ABC-127.mp4" },
      ],
    });
    await state.repositories.scrapeRuns.commitOutcome({
      outcome: "failed",
      itemId: "failed-item",
      error: "boom",
      completedAt: new Date(1_700_000_001_000),
    });

    const readTotalChanges = (): number => {
      const row = state.database.sqlite.prepare("SELECT total_changes() AS count").get();
      if (!row || typeof row !== "object" || !("count" in row) || typeof row.count !== "number") {
        throw new Error("SQLite total_changes() returned an invalid row");
      }
      return row.count;
    };
    const changesBeforeProjectionReads = readTotalChanges();

    const historyResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/scrape.history?input=${encodeURIComponent(JSON.stringify({ taskId: manifest.id }))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(historyResponse.statusCode).toBe(200);
    expect(historyResponse.json().result.data.runs[0]).toMatchObject({
      id: manifest.id,
      disposition: "interrupted",
      completedAt: null,
    });
    expect(historyResponse.json().result.data.results).toEqual([
      expect.objectContaining({
        id: "failed-item",
        persistenceState: "terminal",
        status: "failed",
        error: "boom",
      }),
    ]);

    const repeatedHistoryResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/scrape.history?input=${encodeURIComponent(JSON.stringify({ taskId: manifest.id }))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(repeatedHistoryResponse.json().result.data).toEqual(historyResponse.json().result.data);
    expect(readTotalChanges()).toBe(changesBeforeProjectionReads);
  });

  it("retains completed preparation while a paused task resumes", async () => {
    const root = await createTempRoot("scrape-pause-resume-root");
    await writeFile(join(root, "ABC-123.mp4"), "video");
    await writeFile(join(root, "ABC-456.mp4"), "video");
    const imageServer = await startTestImageServer();
    const gated = createGatedAggregation(`${imageServer.url}/image.png`);
    const { fastify } = await createTestServer({ scrapeAggregation: gated.aggregation });
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, root);
    await fastify.inject({
      method: "POST",
      url: "/trpc/config.update",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        scrape: { threadNumber: 1 },
        download: { downloadSceneImages: false, downloadTrailer: false },
      },
    });

    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.start",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        executionMode: "batch",
        refs: [
          { rootId, relativePath: "ABC-123.mp4" },
          { rootId, relativePath: "ABC-456.mp4" },
        ],
        outputRootId: rootId,
      },
    });
    const taskId = startResponse.json().result.data.runId;

    // Pause while the first file is still inside its aggregation call, so the second file has
    // not been dequeued yet and stays pending.
    await gated.firstCallStarted;
    const pausedResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.pause",
      headers: { authorization: `Bearer ${token}` },
      payload: { taskId },
    });
    expect(pausedResponse.statusCode).toBe(200);
    expect(pausedResponse.json().result.data).toEqual({ runId: taskId });
    await waitForScrapeRunStatus(fastify, token, taskId, "paused");
    gated.releaseFirstCall();
    expect(gated.aggregatedNumbers).toEqual(["ABC-123"]);

    await expect
      .poll(
        async () => {
          const response = await fastify.inject({
            method: "GET",
            url: "/trpc/scrape.liveRuns",
            headers: { authorization: `Bearer ${token}` },
          });
          return response.json().result.data.runs[0];
        },
        { timeout: 10_000 },
      )
      .toMatchObject({
        task: { id: taskId, status: "paused", continuity: "live" },
        progress: { percent: 25, completedItems: 0, totalItems: 2 },
        items: expect.arrayContaining([
          expect.objectContaining({ status: "pending" }),
          expect.objectContaining({ status: "pending" }),
        ]),
      });

    await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.resume",
      headers: { authorization: `Bearer ${token}` },
      payload: { taskId },
    });
    await waitForScrapeRunStatus(fastify, token, taskId, "completed");

    // The resumed run fetches only the file whose preparation never completed.
    expect(gated.aggregatedNumbers).toEqual(["ABC-123", "ABC-456"]);

    const historyResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/scrape.history?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(historyResponse.json().result.data.runs[0].successCount).toBe(2);
  });
});

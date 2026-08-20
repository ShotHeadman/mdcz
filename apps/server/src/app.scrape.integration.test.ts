import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AggregationResult, MountedRootScrapeAggregationService } from "@mdcz/runtime/scrape";
import { Website } from "@mdcz/shared/enums";
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

const createGatedAggregation = (
  imageUrl: string,
): {
  aggregation: MountedRootScrapeAggregationService;
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
      async aggregate(number, configuration, signal, manualScrape): Promise<AggregationResult | null> {
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
      taskEvents.push(event.data);
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
      payload: { refs: [{ rootId, relativePath: "ABC-123.mp4" }] },
    });
    const taskId = startResponse.json().result.data.id;
    expect(startResponse.json().result.data.videoCount).toBe(0);

    await waitForTaskStatus(fastify, token, taskId, "completed");

    const scrapeResultsResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/scrape.listResults?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const scrapeResultId = scrapeResultsResponse.json().result.data.results[0].id;
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
      url: "/trpc/library.search",
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
    expect(cropSessionResponse.statusCode).toBe(200);
    expect(cropSession.sourceRelativePath).toBe("JAV_output/Actor A/ABC-123/thumb.png");
    expect(cropSession.targetRelativePath).toBe("JAV_output/Actor A/ABC-123/poster.png");
    expect(cropSaveResponse.statusCode).toBe(200);
    expect(cropSaveResponse.json().result.data.revision).toEqual(expect.any(String));
    expect(libraryResponse.json().result.data.total).toBe(1);
    expect(entry).toMatchObject({
      actors: ["Actor A"],
      available: null,
      fileName: "ABC-123.mp4",
      mediaIdentity: "ABC-123",
      number: "ABC-123",
      rootId,
      rootDisplayName: root.split(/[\\/]+/u).at(-1),
    });
    expect(entry.relativePath).toBe(outputRelativePath);
    expect(availabilityResponse.statusCode).toBe(200);
    expect(availabilityResponse.json().result.data.entries[0]).toMatchObject({
      id: entry.id,
      available: true,
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
    expect(nfoContent).toContain("Runtime Title ABC-123");
    expect(nfoContent).toContain(".actors/Actor A.jpg");
    expect(nfoContent).not.toContain("<director>Runtime Director</director>");
    expect(nfoContent).toContain("<trailer>");
    expect(nfoContent).toContain("trailer_source_url");
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
  });

  it("keeps organized video on the media root while serving metadata from a local mirror root", async () => {
    const mediaRoot = await createTempRoot("separate-metadata-media");
    const metadataRoot = await createTempRoot("separate-metadata-local");
    await writeFile(join(mediaRoot, "ABC-123.mp4"), "video");
    const imageServer = await startTestImageServer();
    const { fastify } = await createTestServer({
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
      },
    });

    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.start",
      headers: { authorization: `Bearer ${token}` },
      payload: { refs: [{ rootId, relativePath: "ABC-123.mp4" }] },
    });
    const taskId = startResponse.json().result.data.id;
    await waitForTaskStatus(fastify, token, taskId, "completed");

    const resultsResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/scrape.listResults?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const result = resultsResponse.json().result.data.results[0];
    const outputRelativePath = "JAV_output/Actor A/ABC-123/ABC-123.mp4";
    const nfoRelativePath = "JAV_output/Actor A/ABC-123/ABC-123.nfo";
    const strmRelativePath = "JAV_output/Actor A/ABC-123/ABC-123.strm";
    const posterRelativePath = "JAV_output/Actor A/ABC-123/poster.png";

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
    expect(rootsResponse.json().result.data.roots.map((root: { id: string }) => root.id)).not.toContain(
      result.nfoRootId,
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
  });

  it("starts scrape tasks from selected host files inside scan and media roots", async () => {
    const root = await createTempRoot("selected-scrape-root");
    const selectedPath = join(root, "ABC-128.mp4");
    await writeFile(selectedPath, "video");
    const imageServer = await startTestImageServer();
    const { fastify } = await createTestServer({
      scrapeAggregation: createTestAggregation(`${imageServer.url}/image.png`),
    });
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, root);

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
    await waitForTaskStatus(fastify, token, taskId, "completed");
  });

  it("confirms moved uncensored outputs in place without scraping the old source again", async () => {
    const root = await createTempRoot("ambiguous-uncensored-root");
    await writeFile(join(root, "ABP-999-U.mp4"), "video");
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
    const completedEvents: unknown[] = [];
    services.taskEvents.subscribe((event) => {
      if (event.data.kind === "event" && event.data.event.type === "completed") {
        completedEvents.push(event.data);
      }
    });
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, root);
    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.start",
      headers: { authorization: `Bearer ${token}` },
      payload: { refs: [{ rootId, relativePath: "ABP-999-U.mp4" }] },
    });
    const taskId = startResponse.json().result.data.id;

    await waitForTaskStatus(fastify, token, taskId, "completed");
    const initialResults = await services.persistence
      .getState()
      .then((state) => state.repositories.library.listScrapeResults(taskId));
    const initialResult = initialResults[0];
    expect(initialResult?.outputRelativePath).not.toBe("ABP-999-U.mp4");
    await expect(readFile(join(root, "ABP-999-U.mp4"))).rejects.toMatchObject({ code: "ENOENT" });

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
        nfoRelativePath: initialResult?.nfoRelativePath,
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
      status: "completed",
    });
    expect(confirmResponse.json().result.data.id).toBe(taskId);
    expect(aggregateCount).toBe(1);
    const confirmedResultsResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/scrape.listResults?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const confirmedResult = confirmedResultsResponse.json().result.data.results[0];
    expect(confirmedResult).toMatchObject({ status: "success", uncensoredAmbiguous: false });
    expect(confirmedResult.outputRelativePath).toContain("流出");
    await expect(readFile(join(root, confirmedResult.outputRelativePath))).resolves.toBeTruthy();

    const repeatedResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.confirmUncensored",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        taskId,
        items: [{ ref: { rootId, relativePath: "ABP-999-U.mp4" }, choice: "leak" }],
      },
    });
    expect(repeatedResponse.statusCode).toBe(200);
    expect(repeatedResponse.json().result.data.id).toBe(taskId);
    expect(aggregateCount).toBe(1);
  });

  it("rejects confirmation items without successful persisted outputs", async () => {
    const root = await createTempRoot("uncensored-choice-root");
    const { fastify, services } = await createTestServer();
    const token = await loginAsAdmin(fastify);
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
    expect(confirmResponse.json().result.data.id).toBe(task.id);
    const results = await state.repositories.library.listScrapeResults(task.id);
    expect(results.every((result) => result.uncensoredAmbiguous)).toBe(true);
  });

  it("rejects uncensored confirmation refs outside the task", async () => {
    const root = await createTempRoot("uncensored-invalid-root");
    const { fastify } = await createTestServer();
    const token = await loginAsAdmin(fastify);
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
    const root = await createTempRoot("uncensored-missing-root");
    const { fastify } = await createTestServer();
    const token = await loginAsAdmin(fastify);
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
    const root = await createTempRoot("selected-scrape-root");
    const otherRoot = await createTempRoot("selected-scrape-other");
    const selectedPath = join(otherRoot, "ABC-129.mp4");
    await writeFile(selectedPath, "video");
    const { fastify } = await createTestServer();
    const token = await loginAsAdmin(fastify);
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
    const root = await createTempRoot("selected-unregistered-root");
    const configuredRoot = await createTempRoot("configured-media-root");
    const selectedPath = join(root, "ABC-130.mp4");
    await writeFile(selectedPath, "video");
    const { fastify } = await createTestServer();
    const token = await loginAsAdmin(fastify);
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
    const root = await createTempRoot("scrape-stop-root");
    await writeFile(join(root, "ABC-124.mp4"), "video");
    const control = createAbortAwareAggregation();
    const { fastify } = await createTestServer({ scrapeAggregation: control.aggregation });
    const token = await loginAsAdmin(fastify);
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
    await waitForTaskStatus(fastify, token, taskId, "failed");

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
    const root = await createTempRoot("scrape-recover-root");
    await writeFile(join(root, "ABC-126.mp4"), "video");
    await writeFile(join(root, "ABC-127.mp4"), "video");
    const { fastify, services } = await createTestServer();
    const token = await loginAsAdmin(fastify);
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

  it("does not re-scrape finished files when a paused task resumes", async () => {
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
        refs: [
          { rootId, relativePath: "ABC-123.mp4" },
          { rootId, relativePath: "ABC-456.mp4" },
        ],
      },
    });
    const taskId = startResponse.json().result.data.id;

    // Pause while the first file is still inside its aggregation call, so the second file has
    // not been dequeued yet and stays pending.
    await gated.firstCallStarted;
    await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.pause",
      headers: { authorization: `Bearer ${token}` },
      payload: { taskId },
    });
    gated.releaseFirstCall();
    await waitForTaskStatus(fastify, token, taskId, "paused");
    expect(gated.aggregatedNumbers).toEqual(["ABC-123"]);

    await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.resume",
      headers: { authorization: `Bearer ${token}` },
      payload: { taskId },
    });
    await waitForTaskStatus(fastify, token, taskId, "completed");

    // The resumed run picks up only the file that never reached a terminal status.
    expect(gated.aggregatedNumbers).toEqual(["ABC-123", "ABC-456"]);

    const detailResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/tasks.detail?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(detailResponse.json().result.data.task.videoCount).toBe(2);
  });
});

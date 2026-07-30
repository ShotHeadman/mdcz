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
    expect(nfoContent).toContain("<director>Runtime Director</director>");
    expect(nfoContent).not.toContain("<trailer>");
    expect(nfoContent).not.toContain("trailer_source_url");
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

  it("emits ambiguous uncensored items on scrape completion and restarts confirmed refs", async () => {
    const root = await createTempRoot("ambiguous-uncensored-root");
    await writeFile(join(root, "ABP-999-U.mp4"), "video");
    const imageServer = await startTestImageServer();
    const { fastify, services } = await createTestServer({
      scrapeAggregation: createAmbiguousUncensoredAggregation(`${imageServer.url}/image.png`),
    });
    const completedEvents: unknown[] = [];
    services.taskEvents.subscribe((event) => {
      if (event.data.kind === "event" && event.data.event.type === "completed") {
        completedEvents.push(event.data);
      }
    });
    const token = await loginAsAdmin(fastify);
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

    await waitForTaskStatus(fastify, token, taskId, "completed");

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

    await waitForTaskStatus(fastify, token, confirmedTaskId, "completed");
    const confirmedResultsResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/scrape.listResults?input=${encodeURIComponent(JSON.stringify({ taskId: confirmedTaskId }))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(confirmedResultsResponse.json().result.data.results[0]?.uncensoredAmbiguous).toBe(false);
  });

  it("accepts each uncensored confirmation choice", async () => {
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
    const queuedResults = await state.repositories.library.listScrapeResults(confirmResponse.json().result.data.id);
    expect(queuedResults.map((result) => result.relativePath).sort()).toEqual([
      "LEAK-001.mp4",
      "UMR-001.mp4",
      "UNC-001.mp4",
    ]);
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
});

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deterministicMediaRootId } from "@mdcz/media-store";
import { afterEach, describe, expect, it } from "vitest";
import { createTempDirectory, type TempDirectoryHarness } from "../../../tests/harness/tempDirectory";
import { closeTestServers, createTestServer, loginAsAdmin, syncMediaRootFromConfig } from "./app.testSupport";

let mediaDirectory: TempDirectoryHarness | undefined;

afterEach(async () => {
  await closeTestServers();
  await mediaDirectory?.cleanup();
  mediaDirectory = undefined;
});

describe("buildServer scan integration", () => {
  it("scans a configured media root and persists task details across Server boundaries", async () => {
    mediaDirectory = await createTempDirectory("server-scan-root");
    await mkdir(join(mediaDirectory.path, "nested"));
    await writeFile(join(mediaDirectory.path, "nested", "movie.mp4"), "video");
    await writeFile(join(mediaDirectory.path, "nested", "trailer.mp4"), "trailer");
    await writeFile(join(mediaDirectory.path, "nested", "notes.txt"), "text");

    const { fastify } = await createTestServer();
    const token = await loginAsAdmin(fastify);
    const rootId = await syncMediaRootFromConfig(fastify, token, mediaDirectory.path);

    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scans.start",
      headers: { authorization: `Bearer ${token}` },
      payload: { rootId },
    });
    const taskId = startResponse.json().result.data.id;

    expect(startResponse.statusCode).toBe(200);
    await expect
      .poll(async () => {
        const detailResponse = await fastify.inject({
          method: "GET",
          url: `/trpc/scans.detail?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
          headers: { authorization: `Bearer ${token}` },
        });
        return detailResponse.json().result.data.task.status;
      })
      .toBe("completed");

    const detailResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/scans.detail?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const listResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/scans.list",
      headers: { authorization: `Bearer ${token}` },
    });
    const libraryResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/library.list",
      headers: { authorization: `Bearer ${token}` },
      payload: { query: "movie", limit: 20 },
    });
    const logsResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/logs.list",
      headers: { authorization: `Bearer ${token}` },
    });
    const overviewResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/overview.summary",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json().result.data.task).toMatchObject({
      id: taskId,
      kind: "scan",
      rootDisplayName: mediaDirectory.path.split(/[\\/]+/u).at(-1),
      status: "completed",
      videoCount: 1,
      videos: ["nested/movie.mp4"],
    });
    expect(detailResponse.json().result.data.events.map((event: { type: string }) => event.type)).toContain(
      "completed",
    );
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().result.data.tasks[0]).toMatchObject({ id: taskId, kind: "scan" });
    expect(libraryResponse.statusCode).toBe(200);
    expect(libraryResponse.json().result.data).toEqual({
      entries: [],
      fileCount: 0,
      totalBytes: 0,
      hasMore: false,
      nextCursor: null,
      total: 0,
    });
    expect(overviewResponse.statusCode).toBe(200);
    expect(overviewResponse.json().result.data.output).toMatchObject({ fileCount: 0, totalBytes: 0 });
    expect(overviewResponse.json().result.data.recentAcquisitions).toEqual([]);
    expect(logsResponse.json().result.data.logs).toContainEqual(
      expect.objectContaining({ source: "task", taskId, type: "completed" }),
    );

    const clearLogsResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/logs.clearRuntime",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    const clearedLogsResponse = await fastify.inject({
      method: "GET",
      url: "/trpc/logs.list",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(clearLogsResponse.statusCode).toBe(200);
    expect(clearedLogsResponse.json().result.data.logs).not.toContainEqual(
      expect.objectContaining({ source: "task", taskId, type: "completed" }),
    );

    const retryResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/scans.retry",
      headers: { authorization: `Bearer ${token}` },
      payload: { taskId },
    });
    expect(retryResponse.statusCode).toBe(200);
    expect(retryResponse.json().result.data.status).toBe("queued");

    await expect
      .poll(async () => {
        const retriedDetailResponse = await fastify.inject({
          method: "GET",
          url: `/trpc/scans.detail?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
          headers: { authorization: `Bearer ${token}` },
        });
        return retriedDetailResponse.json().result.data.task.status;
      })
      .toBe("completed");

    const retriedLibraryResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/library.list",
      headers: { authorization: `Bearer ${token}` },
      payload: { query: "movie", limit: 20 },
    });
    expect(retriedLibraryResponse.json().result.data.total).toBe(0);
  });

  it("lists supported candidates and applies the current literal filename blacklist", async () => {
    mediaDirectory = await createTempDirectory("server-scan-candidates");
    await mkdir(join(mediaDirectory.path, "nested"));
    await mkdir(join(mediaDirectory.path, "JAV_output"));
    await writeFile(join(mediaDirectory.path, "nested", "movie.mp4"), "video");
    await writeFile(join(mediaDirectory.path, "nested", "trailer.mp4"), "trailer");
    await writeFile(join(mediaDirectory.path, "nested", "notes.txt"), "text");
    await writeFile(join(mediaDirectory.path, "JAV_output", "done.mp4"), "video");
    await mkdir(join(mediaDirectory.path, "default"));
    await writeFile(join(mediaDirectory.path, "default", "kept.mp4"), "video");
    await writeFile(join(mediaDirectory.path, "nested", "DeFaUlT001.mp4"), "video");
    await writeFile(join(mediaDirectory.path, "nested", "ads+[2024].mp4"), "video");
    await writeFile(join(mediaDirectory.path, "nested", "ads-2024.mp4"), "video");

    const { fastify, services } = await createTestServer();
    await services.config.update({ scrape: { filenameBlacklistTokens: ["default", "ADS+[2024]", "   "] } });
    const token = await loginAsAdmin(fastify);
    const response = await fastify.inject({
      method: "GET",
      url: `/trpc/scans.candidates?input=${encodeURIComponent(
        JSON.stringify({ recursive: true, scanDir: mediaDirectory.path, supportedExtensions: ["mp4"] }),
      )}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result.data.candidates).toEqual([
      expect.objectContaining({ name: "kept.mp4" }),
      expect.objectContaining({
        name: "done.mp4",
        ref: { relativePath: "JAV_output/done.mp4", rootId: deterministicMediaRootId(mediaDirectory.path) },
      }),
      expect.objectContaining({ name: "ads-2024.mp4" }),
      expect.objectContaining({
        name: "movie.mp4",
        ref: { relativePath: "nested/movie.mp4", rootId: deterministicMediaRootId(mediaDirectory.path) },
      }),
    ]);
    await services.config.update({ scrape: { filenameBlacklistTokens: [] } });
    const refreshedResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/scans.candidates?input=${encodeURIComponent(JSON.stringify({ recursive: true, scanDir: mediaDirectory.path }))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(refreshedResponse.statusCode).toBe(200);
    expect(refreshedResponse.json().result.data.candidates).toHaveLength(6);
    const shallowResponse = await fastify.inject({
      method: "GET",
      url: `/trpc/scans.candidates?input=${encodeURIComponent(JSON.stringify({ recursive: false, scanDir: mediaDirectory.path }))}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(shallowResponse.statusCode).toBe(200);
    expect(shallowResponse.json().result.data.candidates).toEqual([]);
  });

  it("reuses the enclosing root for a nested scan directory so candidates cannot escape it", async () => {
    mediaDirectory = await createTempDirectory("server-subdirectory-candidates");
    const selectedDirectory = join(mediaDirectory.path, "selected");
    await mkdir(selectedDirectory);
    await writeFile(join(selectedDirectory, "inside.mp4"), "video");
    await writeFile(join(mediaDirectory.path, "outside.mp4"), "video");

    const { fastify } = await createTestServer();
    const token = await loginAsAdmin(fastify);
    const parentRootId = await syncMediaRootFromConfig(fastify, token, mediaDirectory.path);
    const response = await fastify.inject({
      method: "GET",
      url: `/trpc/scans.candidates?input=${encodeURIComponent(JSON.stringify({ recursive: true, scanDir: selectedDirectory }))}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result.data.candidates).toEqual([
      expect.objectContaining({
        name: "inside.mp4",
        path: join(selectedDirectory, "inside.mp4"),
        ref: { rootId: parentRootId, relativePath: "selected/inside.mp4" },
      }),
    ]);
  });
});

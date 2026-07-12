import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NfoGenerator } from "@mdcz/runtime/scrape";
import { Website } from "@mdcz/shared/enums";
import { afterEach, describe, expect, it } from "vitest";
import { closeTestServers, createTestServer, syncMediaRootFromConfig } from "./app.testSupport";

afterEach(async () => {
  await closeTestServers();
});

describe("buildServer maintenance integration", () => {
  it("scans selected maintenance files through runtime semantics", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-maintenance-selected-root-"));
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
    const loginResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "admin" },
    });
    const token = loginResponse.json().result.data.token;
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

  it("runs maintenance preview and apply through task-backed logs", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-maintenance-root-"));
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
    const loginResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "admin" },
    });
    const token = loginResponse.json().result.data.token;
    const rootId = await syncMediaRootFromConfig(fastify, token, root);

    const startResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/maintenance.start",
      headers: { authorization: `Bearer ${token}` },
      payload: { rootId, presetId: "read_local" },
    });
    const taskId = startResponse.json().result.data.id;

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
      presetId: "read_local",
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
      relativePath: "ABC-125.mp4",
      title: "Local Title ABC-125",
    });
    expect(logsResponse.json().result.data.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "task", message: expect.stringContaining("Maintenance") }),
      ]),
    );
  });
});

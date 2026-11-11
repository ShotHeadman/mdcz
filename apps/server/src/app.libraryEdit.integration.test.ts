import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseNfoSnapshot } from "@mdcz/runtime/maintenance";
import { acquireOutputDirectories } from "@mdcz/runtime/publication/outputMutex";
import { NfoGenerator } from "@mdcz/runtime/scrape";
import { Website } from "@mdcz/shared/enums";
import type { LibraryEditJobDto } from "@mdcz/shared/libraryEdit";
import type { CrawlerData } from "@mdcz/shared/types";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { closeTestServers, createTempRoot, createTestLibrary, createTestServer, loginAsAdmin } from "./app.testSupport";

afterEach(closeTestServers);

it("edits each locked NFO and its record atomically, survives reattachment, and counts independent movie outcomes", async () => {
  const app = await createTestServer();
  const { fastify, services } = app;
  const token = await loginAsAdmin(fastify);
  const headers = { authorization: `Bearer ${token}` };
  const directory = await createTempRoot("library-edit");
  const { rootId, libraryId } = await createTestLibrary(fastify, token, directory, {
    placement: "inPlace",
    outputPath: "",
  });
  const { repositories } = await services.persistence.getState();
  const data: CrawlerData = {
    website: Website.JAVDB,
    title: "Original",
    number: "ABC-123",
    actors: ["ＡＩ"],
    actor_profiles: [{ name: "ＡＩ", aliases: ["Alias"], height_cm: 170 }],
    genres: ["Drama"],
    scene_images: [],
  };
  const generator = new NfoGenerator();
  const targets = [join(directory, "first", "video.nfo"), join(directory, "second", "movie.nfo")];
  for (const folder of ["first", "second"]) await mkdir(join(directory, folder));
  const original = generator.buildXml(data).replace("</movie>", "<providerid>first</providerid></movie>");
  const second = generator
    .buildXml({ ...data, title: "Second copy", genres: ["HD"] })
    .replace(/<uniqueid[^>]*>.*?<\/uniqueid>/gu, "")
    .replace("</movie>", "<providerid>second</providerid></movie>");
  await writeFile(targets[0], original);
  await writeFile(targets[1], second);
  await writeFile(join(directory, "broken.nfo"), "<movie><title>Broken</movie>");
  for (const [id, paths] of [
    ["copies", ["first/video.nfo", "second/movie.nfo"]],
    ["no-nfo", []],
    ["broken", ["broken.nfo"]],
  ] as const) {
    repositories.library.writeEntry(
      {
        id,
        title: data.title,
        number: data.number,
        actors: data.actors,
        crawlerDataJson: JSON.stringify(data),
        assets: paths.map((relativePath) => ({
          kind: "nfo",
          uri: relativePath,
          relativePath,
          rootId,
          published: relativePath === "first/video.nfo",
        })),
      },
      [{ fileId: id, rootId, rootRelativePath: `${id}.mp4` }],
    );
  }
  const input = {
    ids: ["copies", "no-nfo", "broken"],
    edit: { field: "actors", operation: "rename", from: "AI", to: "Renamed" },
  };
  const start = () => fastify.inject({ method: "POST", url: "/trpc/library.edit.start", headers, payload: input });
  const status = async (): Promise<LibraryEditJobDto> => {
    const response = await fastify.inject({ method: "GET", url: "/trpc/library.edit.status", headers });
    expect(response.statusCode).toBe(200);
    return response.json().result.data;
  };
  const release = await acquireOutputDirectories(targets);
  onTestFinished(release);
  const first = await start();
  expect(first.statusCode, first.body).toBe(200);
  expect(await status()).toMatchObject({ id: first.json().result.data.id, status: "running", current: 0, total: 3 });
  const overlapping = await start();
  expect(overlapping.statusCode).toBe(409);
  expect(overlapping.body).toContain("library edit is running");
  const scrape = await fastify.inject({
    method: "POST",
    url: "/trpc/scrape.start",
    headers,
    payload: { libraryId, executionMode: "single", refs: [{ rootId, relativePath: "copies.mp4" }] },
  });
  expect(scrape.statusCode).toBe(409);
  expect(scrape.body).toContain("library edit is running");
  await writeFile(targets[0], original.replace("<genre>Drama</genre>", "<genre>Changed under lock</genre>"));
  release();
  await expect.poll(async () => (await status()).status).toBe("completed");
  expect(await status()).toMatchObject({
    current: 3,
    total: 3,
    changed: 1,
    unchanged: 0,
    skipped: 1,
    failures: [{ id: "broken", reason: expect.stringContaining("Invalid NFO XML") }],
  });
  const written = await Promise.all(targets.map((target) => readFile(target, "utf8")));
  for (const [index, xml] of written.entries()) {
    const snapshot = parseNfoSnapshot(xml);
    expect(snapshot.crawlerData).toMatchObject({
      title: index ? "Second copy" : "Original",
      actors: ["Renamed"],
      genres: [index ? "HD" : "Changed under lock"],
    });
    expect(snapshot.localState?.edits?.actor).toBeDefined();
    expect(xml).toContain(`<providerid>${index ? "second" : "first"}</providerid>`);
  }
  const stored = await repositories.library.getEntryById("copies");
  if (!stored.crawlerDataJson) throw new Error("Missing record metadata");
  expect(JSON.parse(stored.crawlerDataJson)).toMatchObject({
    actors: ["Renamed"],
    actor_profiles: [{ name: "Renamed", aliases: ["Alias"], height_cm: 170 }],
    genres: ["Drama"],
  });
  expect((await repositories.library.getEntryById("no-nfo")).crawlerDataJson).toBe(JSON.stringify(data));
  expect((await repositories.library.getEntryById("broken")).crawlerDataJson).toBe(JSON.stringify(data));

  await start();
  await expect.poll(async () => (await status()).status).toBe("completed");
  expect(await status()).toMatchObject({ changed: 0, unchanged: 1, skipped: 1, failures: [{ id: "broken" }] });
  expect(await Promise.all(targets.map((target) => readFile(target, "utf8")))).toEqual(written);

  const writeEntry = vi.spyOn(repositories.library, "writeEntry").mockImplementationOnce(() => {
    throw new Error("Commit rejected");
  });
  const failedCommit = await fastify.inject({
    method: "POST",
    url: "/trpc/library.edit.start",
    headers,
    payload: { ids: ["copies"], edit: { field: "series", operation: "set", value: "New series" } },
  });
  expect(failedCommit.statusCode).toBe(200);
  await expect.poll(async () => (await status()).status).toBe("completed");
  expect(await status()).toMatchObject({ changed: 0, failures: [{ id: "copies", reason: "Commit rejected" }] });
  expect(await Promise.all(targets.map((target) => readFile(target, "utf8")))).toEqual(written);
  expect((await repositories.library.getEntryById("copies")).crawlerDataJson).toBe(stored.crawlerDataJson);
  writeEntry.mockRestore();

  await services.config.update({ download: { nfoIgnoreFields: ["studio"] } });
  const excluded = await fastify.inject({
    method: "POST",
    url: "/trpc/library.edit.start",
    headers,
    payload: { ids: ["copies"], edit: { field: "studio", operation: "clear" } },
  });
  expect(excluded.statusCode).not.toBe(200);
  expect(excluded.body).toContain("download.nfoIgnoreFields");
});

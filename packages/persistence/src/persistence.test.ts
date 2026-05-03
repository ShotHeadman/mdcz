import { createMediaRoot } from "@mdcz/storage";
import { afterEach, describe, expect, it } from "vitest";

import type { PersistenceDatabase } from "./database";
import { PersistenceError, persistenceErrorCodes } from "./errors";
import { LibraryRepository } from "./libraryRepository";
import { MediaRootRepository } from "./mediaRootRepository";
import { createTestPersistenceDatabase } from "./testDatabase";

let database: PersistenceDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("MediaRootRepository", () => {
  it("migrates isolated test databases with the package migration facade", () => {
    database = createTestPersistenceDatabase();

    const tables = database.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toContain("media_roots");
    expect(tables).toContain("task_records");
    expect(tables).toContain("scrape_outputs");
    expect(tables).toContain("scrape_results");
    expect(tables).toContain("library_entries");
    expect(tables).toContain("library_items");
    expect(tables).toContain("library_item_files");
    expect(tables).toContain("library_item_assets");
    expect(tables).toContain("__drizzle_migrations");
  });

  it("persists and reads media roots through the facade", async () => {
    database = createTestPersistenceDatabase();
    const repository = new MediaRootRepository(database);
    const root = createMediaRoot({
      id: "root-1",
      displayName: "Movies",
      hostPath: "/mnt/media",
      now: new Date("2026-04-28T00:00:00.000Z"),
    });

    const persistedRoot = { ...root, deleted: false };

    await repository.upsert(root);

    await expect(repository.get("root-1")).resolves.toEqual(persistedRoot);
    await expect(repository.list()).resolves.toEqual([persistedRoot]);
  });

  it("uses stable not-found errors", async () => {
    database = createTestPersistenceDatabase();
    const repository = new MediaRootRepository(database);

    await expect(repository.get("missing")).rejects.toEqual(
      expect.objectContaining({
        code: persistenceErrorCodes.NotFound,
        name: PersistenceError.name,
      }),
    );
  });
});

describe("LibraryRepository", () => {
  it("persists scrape result rows for task review", async () => {
    database = createTestPersistenceDatabase();
    const repository = new LibraryRepository(database);
    const createdAt = new Date("2026-04-30T00:00:00.000Z");

    const result = await repository.upsertScrapeResult({
      id: "result-1",
      taskId: "task-1",
      rootId: "root-1",
      relativePath: "ABC-123.mp4",
      status: "success",
      crawlerDataJson: JSON.stringify({ title: "Title", number: "ABC-123" }),
      nfoRelativePath: "ABC-123.nfo",
      outputRelativePath: "ABC-123.mp4",
      manualUrl: "https://example.invalid/detail",
      createdAt,
      updatedAt: createdAt,
    });

    await expect(repository.getScrapeResult("result-1")).resolves.toEqual(result);
    await expect(repository.listScrapeResults("task-1")).resolves.toEqual([result]);
  });

  it("persists scrape outputs and upserts durable library entries by root path", async () => {
    database = createTestPersistenceDatabase();
    const repository = new LibraryRepository(database);
    const completedAt = new Date("2026-04-30T00:00:00.000Z");

    const output = await repository.upsertScrapeOutput({
      id: "output-1",
      taskId: "task-1",
      rootId: "root-1",
      outputDirectory: "/output",
      fileCount: 1,
      totalBytes: 10,
      completedAt,
    });
    await repository.upsertEntry({
      rootId: "root-1",
      rootRelativePath: "ABC-123/ABC-123.mp4",
      size: 10,
      sourceTaskId: "task-1",
      scrapeOutputId: output.id,
      title: "Title",
      number: "ABC-123",
      actors: ["Actor"],
      crawlerDataJson: JSON.stringify({ title: "Title", number: "ABC-123", poster_url: "poster.jpg" }),
      indexedAt: completedAt,
    });
    await repository.upsertEntry({
      rootId: "root-1",
      rootRelativePath: "ABC-123/ABC-123.mp4",
      size: 11,
      indexedAt: new Date("2026-04-30T00:01:00.000Z"),
    });

    await expect(repository.latestScrapeOutput()).resolves.toMatchObject({ id: "output-1", fileCount: 1 });
    await expect(repository.listEntries()).resolves.toEqual([
      expect.objectContaining({
        rootRelativePath: "ABC-123/ABC-123.mp4",
        size: 11,
        actors: [],
        crawlerDataJson: null,
      }),
    ]);
  });
});

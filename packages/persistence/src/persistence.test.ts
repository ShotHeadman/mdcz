import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createMediaRoot } from "@mdcz/media-store";
import { afterEach, describe, expect, it } from "vitest";
import { createTempDirectory } from "../../../tests/harness/tempDirectory";

import { createPersistenceDatabase, type PersistenceDatabase } from "./database";
import { PersistenceError, persistenceErrorCodes } from "./errors";
import { LibraryRepository } from "./libraryRepository";
import { MaintenanceRepository } from "./maintenanceRepository";
import { MediaRootRepository } from "./mediaRootRepository";
import { defaultMigrationsFolder, runMigrations } from "./migrate";
import { TaskRepository } from "./taskRepository";
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
    expect(tables).toContain("maintenance_previews");
    expect(tables).toContain("maintenance_apply_log");
    expect(tables).toContain("library_entries");
    expect(tables).toContain("library_items");
    expect(tables).toContain("library_item_files");
    expect(tables).toContain("library_item_assets");
    expect(tables).toContain("__drizzle_migrations");

    const indexes = database.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        "library_item_assets_item_idx",
        "library_item_files_item_idx",
        "library_item_files_root_path_idx",
        "library_items_source_task_idx",
        "media_roots_deleted_idx",
        "scan_results_task_root_path_idx",
        "scrape_results_task_path_idx",
        "task_events_task_created_at_idx",
      ]),
    );
  });

  it("configures SQLite for bounded WAL concurrency", () => {
    database = createTestPersistenceDatabase();

    expect(database.sqlite.pragma("journal_mode", { simple: true })).toBe("memory");
    expect(database.sqlite.pragma("busy_timeout", { simple: true })).toBe(5000);
    expect(database.sqlite.pragma("synchronous", { simple: true })).toBe(1);
  });

  it("upgrades a pre-index database by deduplicating legacy scan results", async () => {
    const migrations = await createTempDirectory("persistence-old-migrations");
    try {
      await mkdir(join(migrations.path, "meta"), { recursive: true });
      await Promise.all(
        ["0000_initial.sql", "0001_separate_metadata_root.sql"].map(
          async (fileName) => await cp(join(defaultMigrationsFolder, fileName), join(migrations.path, fileName)),
        ),
      );
      const journal = JSON.parse(await readFile(join(defaultMigrationsFolder, "meta", "_journal.json"), "utf8")) as {
        entries: Array<{ idx: number }>;
        version: string;
        dialect: string;
      };
      await writeFile(
        join(migrations.path, "meta", "_journal.json"),
        JSON.stringify({ ...journal, entries: journal.entries.filter((entry) => entry.idx < 2) }),
      );

      database = createPersistenceDatabase({ path: ":memory:" });
      runMigrations(database, { migrationsFolder: migrations.path });
      const insert = database.sqlite.prepare(
        "INSERT INTO scan_results (task_id, root_id, relative_path, size, modified_at) VALUES (?, ?, ?, ?, ?)",
      );
      insert.run("task-1", "root-1", "ABC-001.mp4", 10, 100);
      insert.run("task-1", "root-1", "ABC-001.mp4", 20, 200);

      runMigrations(database);

      expect(
        database.sqlite.prepare("SELECT task_id, root_id, relative_path, size, modified_at FROM scan_results").all(),
      ).toEqual([{ task_id: "task-1", root_id: "root-1", relative_path: "ABC-001.mp4", size: 20, modified_at: 200 }]);
      expect(() => insert.run("task-1", "root-1", "ABC-001.mp4", 30, null)).toThrow(/UNIQUE constraint failed/u);
    } finally {
      await migrations.cleanup();
    }
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

describe("MaintenanceRepository", () => {
  it("persists maintenance previews and apply logs", async () => {
    database = createTestPersistenceDatabase();
    const repository = new MaintenanceRepository(database);
    const createdAt = new Date("2026-05-01T00:00:00.000Z");

    const preview = await repository.upsertPreview({
      id: "preview-1",
      taskId: "task-1",
      rootId: "root-1",
      relativePath: "ABC-123.mp4",
      presetId: "read_local",
      status: "ready",
      fieldDiffsJson: "[]",
      unchangedFieldDiffsJson: "[]",
      createdAt,
      updatedAt: createdAt,
    });
    const log = await repository.addApplyLog({
      id: "apply-1",
      taskId: "task-1",
      previewId: preview.id,
      rootId: preview.rootId,
      relativePath: preview.relativePath,
      presetId: preview.presetId,
      status: "success",
      appliedAt: createdAt,
    });

    await expect(repository.listPreviews("task-1")).resolves.toEqual([preview]);
    await expect(repository.listApplyLogs("task-1")).resolves.toEqual([log]);
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
      nfoRootId: "metadata-root",
      nfoRelativePath: "ABC-123.nfo",
      outputRelativePath: "ABC-123.mp4",
      manualUrl: "https://example.invalid/detail",
      uncensoredAmbiguous: true,
      createdAt,
      updatedAt: createdAt,
    });

    await expect(repository.getScrapeResult("result-1")).resolves.toEqual({
      ...result,
      uncensoredAmbiguous: true,
    });
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
      createdAt: completedAt,
    });
    await repository.upsertEntry({
      rootId: "root-1",
      rootRelativePath: "ABC-123/ABC-123.mp4",
      size: 11,
      createdAt: new Date("2026-04-30T00:01:00.000Z"),
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

  it("uses the root-path index for library entry lookup", async () => {
    database = createTestPersistenceDatabase();
    const plan = database.sqlite
      .prepare(
        "EXPLAIN QUERY PLAN SELECT * FROM library_item_files WHERE root_id = ? AND root_relative_path = ? LIMIT 1",
      )
      .all("root-1", "ABC-123/ABC-123.mp4") as Array<{ detail: string }>;

    expect(plan.some((row) => row.detail.includes("library_item_files_root_path_idx"))).toBe(true);
  });

  it("paginates library entries with a stable created-at and id cursor", async () => {
    database = createTestPersistenceDatabase();
    const repository = new LibraryRepository(database);
    const createdAt = new Date("2026-05-01T00:00:00.000Z");
    await repository.upsertEntry({
      id: "entry-a",
      rootId: "root-1",
      rootRelativePath: "A/ABC-001.mp4",
      title: "Alpha",
      createdAt,
    });
    await repository.upsertEntry({
      id: "entry-b",
      rootId: "root-1",
      rootRelativePath: "B/ABC-002.mp4",
      title: "Beta",
      createdAt,
    });
    await repository.upsertEntry({
      id: "entry-c",
      rootId: "root-2",
      rootRelativePath: "C/DEF-003.mp4",
      title: "Gamma",
      createdAt: new Date("2026-05-02T00:00:00.000Z"),
    });

    const first = await repository.listEntriesPage({ limit: 2 });
    const second = await repository.listEntriesPage({ cursor: first.nextCursor ?? undefined, limit: 2 });

    expect(first.entries.map((entry) => entry.id)).toEqual(["entry-c", "entry-b"]);
    expect(first).toMatchObject({ hasMore: true, total: 3 });
    expect(second.entries.map((entry) => entry.id)).toEqual(["entry-a"]);
    expect(second).toMatchObject({ hasMore: false, nextCursor: null, total: 3 });
  });

  it("filters paged library entries by file/root and metadata in SQL", async () => {
    database = createTestPersistenceDatabase();
    const repository = new LibraryRepository(database);
    await repository.upsertEntry({
      id: "entry-1",
      rootId: "root-1",
      rootRelativePath: "movies/ABC-123.mp4",
      actors: ["Actor One"],
      title: "First title",
    });
    await repository.upsertEntry({
      id: "entry-2",
      rootId: "root-2",
      rootRelativePath: "other/DEF-456.mp4",
      title: "Second title",
    });

    await expect(repository.listEntriesPage({ limit: 10, query: "actor one" })).resolves.toMatchObject({
      entries: [expect.objectContaining({ id: "entry-1" })],
      total: 1,
    });
    await expect(repository.listEntriesPage({ limit: 10, query: "abc-123" })).resolves.toMatchObject({
      entries: [expect.objectContaining({ id: "entry-1" })],
      total: 1,
    });
    await expect(repository.listEntriesPage({ limit: 10, rootId: "root-2" })).resolves.toMatchObject({
      entries: [expect.objectContaining({ id: "entry-2" })],
      total: 1,
    });
  });

  it("filters deleted roots before pagination and treats LIKE metacharacters literally", async () => {
    database = createTestPersistenceDatabase();
    const repository = new LibraryRepository(database);
    const roots = new MediaRootRepository(database);
    const now = new Date("2026-05-01T00:00:00.000Z");
    await roots.upsert(createMediaRoot({ id: "active-root", displayName: "Active", hostPath: "/active", now }));
    await roots.upsert({
      ...createMediaRoot({ id: "deleted-root", displayName: "Deleted", hostPath: "/deleted", now }),
      deleted: true,
    });
    await repository.upsertEntry({
      id: "active-entry",
      rootId: "active-root",
      rootRelativePath: "100%-title.mp4",
      title: "100% title",
      createdAt: now,
    });
    await repository.upsertEntry({
      id: "deleted-entry",
      rootId: "deleted-root",
      rootRelativePath: "deleted.mp4",
      title: "Deleted title",
      createdAt: new Date(now.getTime() - 1),
    });

    await expect(repository.listEntriesPage({ limit: 1 })).resolves.toMatchObject({
      entries: [expect.objectContaining({ id: "active-entry" })],
      total: 1,
      hasMore: false,
    });
    await expect(repository.listEntriesPage({ limit: 10, query: "%" })).resolves.toMatchObject({
      entries: [expect.objectContaining({ id: "active-entry" })],
      total: 1,
    });
  });

  it("prefers poster assets for library row artwork", async () => {
    database = createTestPersistenceDatabase();
    const repository = new LibraryRepository(database);

    await repository.upsertEntry({
      rootId: "root-1",
      rootRelativePath: "ABC-123/ABC-123.mp4",
      crawlerDataJson: JSON.stringify({
        thumb_url: "ABC-123/thumb.jpg",
        poster_url: "ABC-123/poster.jpg",
      }),
      thumbnailPath: "ABC-123/thumb.jpg",
      assets: [
        { kind: "thumb", uri: "ABC-123/thumb.jpg", rootId: "root-1", relativePath: "ABC-123/thumb.jpg" },
        { kind: "poster", uri: "ABC-123/poster.jpg", rootId: "root-1", relativePath: "ABC-123/poster.jpg" },
      ],
    });

    await expect(repository.listEntries()).resolves.toEqual([
      expect.objectContaining({
        thumbnailPath: "ABC-123/poster.jpg",
      }),
    ]);
  });

  it("relinks the primary library file without retaining the old path", async () => {
    database = createTestPersistenceDatabase();
    const repository = new LibraryRepository(database);
    await repository.upsertEntry({
      id: "entry-1",
      rootId: "root-1",
      rootRelativePath: "old/ABC-123.mp4",
      size: 10,
    });

    await repository.relinkEntry({
      id: "entry-1",
      rootId: "root-1",
      rootRelativePath: "new/ABC-123-流出.mp4",
      size: 11,
    });

    await expect(repository.getEntryById("entry-1")).resolves.toMatchObject({
      rootRelativePath: "new/ABC-123-流出.mp4",
      size: 11,
      files: [expect.objectContaining({ rootRelativePath: "new/ABC-123-流出.mp4" })],
    });
    await expect(repository.getEntry("root-1", "old/ABC-123.mp4")).rejects.toThrow("Library entry not found");
  });

  it("hides entries from recent acquisitions without deleting the library item", async () => {
    database = createTestPersistenceDatabase();
    const repository = new LibraryRepository(database);
    const createdAt = new Date("2026-05-01T00:00:00.000Z");
    const hiddenAt = new Date("2026-05-12T00:00:00.000Z");

    await repository.upsertEntry({
      id: "entry-1",
      rootId: "root-1",
      rootRelativePath: "ABC-123/ABC-123.mp4",
      title: "Title",
      createdAt,
    });

    await repository.hideFromRecent("entry-1", hiddenAt);
    await repository.upsertEntry({
      id: "entry-1",
      rootId: "root-1",
      rootRelativePath: "ABC-123/ABC-123.mp4",
      title: "Refreshed title",
      createdAt: new Date("2026-05-20T00:00:00.000Z"),
    });

    await expect(repository.getEntryById("entry-1")).resolves.toEqual(
      expect.objectContaining({
        id: "entry-1",
        title: "Refreshed title",
        createdAt,
        hiddenFromRecentAt: hiddenAt,
      }),
    );
    await expect(repository.listEntries()).resolves.toHaveLength(1);
  });

  it("deletes a library item with file and asset rows without touching unrelated entries", async () => {
    database = createTestPersistenceDatabase();
    const repository = new LibraryRepository(database);

    await repository.upsertEntry({
      id: "entry-1",
      rootId: "root-1",
      rootRelativePath: "ABC-123/ABC-123.mp4",
      assets: [{ kind: "poster", uri: "ABC-123/poster.jpg", rootId: "root-1", relativePath: "ABC-123/poster.jpg" }],
    });
    await repository.upsertEntry({
      id: "entry-2",
      rootId: "root-1",
      rootRelativePath: "DEF-456/DEF-456.mp4",
    });

    await repository.deleteEntry("entry-1");

    await expect(repository.getEntryById("entry-1")).rejects.toThrow("Library entry not found");
    await expect(repository.listEntries()).resolves.toEqual([
      expect.objectContaining({
        id: "entry-2",
        rootRelativePath: "DEF-456/DEF-456.mp4",
      }),
    ]);
  });
});

describe("TaskRepository", () => {
  it("rejects duplicate scan paths within one task and root", async () => {
    database = createTestPersistenceDatabase();
    const repository = new TaskRepository(database);
    const duplicate = { relativePath: "ABC-123.mp4", size: 10, modifiedAt: null };

    await expect(
      repository.replaceScanResults({
        taskId: "task-1",
        rootId: "root-1",
        results: [duplicate, duplicate],
      }),
    ).rejects.toMatchObject({
      code: persistenceErrorCodes.ConstraintViolation,
      message: "Duplicate scan result path for task task-1: ABC-123.mp4",
    });
  });
});

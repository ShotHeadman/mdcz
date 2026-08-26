import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createMediaRoot } from "@mdcz/media-store";
import { afterEach, describe, expect, it } from "vitest";
import { createTempDirectory } from "../../../tests/harness/tempDirectory";

import { createPersistenceDatabase, type PersistenceDatabase } from "./database";
import { PersistenceError, persistenceErrorCodes } from "./errors";
import { LibraryRepository } from "./libraryRepository";
import { MediaRootRepository } from "./mediaRootRepository";
import { defaultMigrationsFolder, runMigrations } from "./migrate";
import { TaskRepository } from "./taskRepository";
import { createTestPersistenceDatabase } from "./testDatabase";

let database: PersistenceDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("Persistence migrations", () => {
  it("migrates isolated test databases with the package migration facade", () => {
    database = createTestPersistenceDatabase();

    const tables = database.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toContain("media_roots");
    expect(tables).toContain("task_records");
    expect(tables).toContain("scrape_runs");
    expect(tables).toContain("scrape_run_items");
    expect(tables).toContain("scrape_item_outcomes");
    expect(tables).not.toContain("scrape_run_summaries");
    expect(tables).not.toContain("scrape_outputs");
    expect(tables).not.toContain("scrape_results");
    expect(tables).not.toContain("library_entries");
    expect(tables).not.toContain("maintenance_previews");
    expect(tables).not.toContain("maintenance_apply_log");
    expect(tables).not.toContain("maintenance_apply_items");
    expect(tables).not.toContain("maintenance_executions");
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
        "library_items_source_run_idx",
        "media_roots_state_idx",
        "scan_results_task_root_path_idx",
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

  it("upgrades the v0.11 schema through the consolidated migration", async () => {
    const migrations = await createTempDirectory("persistence-v011-migrations");
    try {
      await mkdir(join(migrations.path, "meta"), { recursive: true });
      await cp(join(defaultMigrationsFolder, "0000_initial.sql"), join(migrations.path, "0000_initial.sql"));
      const journal = JSON.parse(await readFile(join(defaultMigrationsFolder, "meta", "_journal.json"), "utf8")) as {
        entries: Array<{ idx: number }>;
      };
      await writeFile(
        join(migrations.path, "meta", "_journal.json"),
        JSON.stringify({ ...journal, entries: journal.entries.filter((entry) => entry.idx === 0) }),
      );

      database = createPersistenceDatabase({ path: ":memory:" });
      runMigrations(database, { migrationsFolder: migrations.path });
      const insertScanResult = database.sqlite.prepare(
        "INSERT INTO scan_results (task_id, root_id, relative_path, size, modified_at) VALUES (?, ?, ?, ?, ?)",
      );
      insertScanResult.run("task-1", "root-1", "ABC-001.mp4", 10, 100);
      insertScanResult.run("task-1", "root-1", "ABC-001.mp4", 20, 200);
      const insertRoot = database.sqlite.prepare(
        "INSERT INTO media_roots (id, display_name, host_path, root_type, enabled, deleted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      );
      insertRoot.run("123e4567-e89b-12d3-a456-426614174000", "Legacy", "/legacy", "mounted-filesystem", 1, 0, 1, 1);
      insertRoot.run("path-deterministic", "Current", "/current", "mounted-filesystem", 1, 0, 1, 1);
      insertRoot.run("mdcz-metadata-output", "Metadata", "/metadata", "mounted-filesystem", 1, 0, 1, 1);
      database.sqlite
        .prepare(
          "INSERT INTO task_records (id, kind, root_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("task-1", "scan", "root-1", "queued", 1, 1);
      database.sqlite
        .prepare(
          "INSERT INTO library_items (id, media_identity, crawler_data_json, source_task_id, scrape_output_id, title, number, actors_json, created_at, last_refreshed_at, hidden_from_recent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "library-1",
          "ABC-001",
          '{"number":"ABC-001"}',
          "legacy-scrape-task",
          "legacy-scrape-output",
          "Legacy title",
          "ABC-001",
          '["Actor"]',
          10,
          11,
          null,
        );
      database.sqlite
        .prepare(
          "INSERT INTO library_item_files (id, item_id, root_id, root_relative_path, file_name, directory, size, modified_at, last_known_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "library-1:primary",
          "library-1",
          "path-deterministic",
          "ABC-001/ABC-001.mp4",
          "ABC-001.mp4",
          "ABC-001",
          123,
          12,
          "ABC-001/ABC-001.mp4",
          10,
          11,
        );
      database.sqlite
        .prepare(
          "INSERT INTO library_item_assets (id, item_id, kind, uri, root_id, relative_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run("asset-1", "library-1", "poster", "ABC-001/poster.jpg", "path-deterministic", "ABC-001/poster.jpg", 10);

      runMigrations(database);

      expect(
        database.sqlite.prepare("SELECT task_id, root_id, relative_path, size, modified_at FROM scan_results").all(),
      ).toEqual([{ task_id: "task-1", root_id: "root-1", relative_path: "ABC-001.mp4", size: 20, modified_at: 200 }]);
      expect(() => insertScanResult.run("task-1", "root-1", "ABC-001.mp4", 30, null)).toThrow(
        /UNIQUE constraint failed/u,
      );
      expect(database.sqlite.prepare("SELECT execution_version FROM task_records WHERE id = ?").get("task-1")).toEqual({
        execution_version: 0,
      });
      expect(database.sqlite.prepare("SELECT id, enabled, deleted FROM media_roots ORDER BY id").all()).toEqual([
        { id: "123e4567-e89b-12d3-a456-426614174000", enabled: 1, deleted: 0 },
        { id: "mdcz-metadata-output", enabled: 1, deleted: 0 },
        { id: "path-deterministic", enabled: 1, deleted: 0 },
      ]);
      const libraryItemColumns = database.sqlite.prepare("PRAGMA table_info(library_items)").all() as Array<{
        name: string;
      }>;
      const libraryItemColumnNames = libraryItemColumns.map((column) => column.name);
      expect(libraryItemColumnNames).toEqual(expect.arrayContaining(["source_run_id", "source_outcome_id"]));
      expect(libraryItemColumnNames).not.toContain("source_task_id");
      expect(libraryItemColumnNames).not.toContain("scrape_output_id");
      expect(
        database.sqlite
          .prepare(
            "SELECT id, media_identity, crawler_data_json, source_run_id, source_outcome_id, title, number, actors_json, created_at, last_refreshed_at, hidden_from_recent_at FROM library_items",
          )
          .all(),
      ).toEqual([
        {
          id: "library-1",
          media_identity: "ABC-001",
          crawler_data_json: '{"number":"ABC-001"}',
          source_run_id: null,
          source_outcome_id: null,
          title: "Legacy title",
          number: "ABC-001",
          actors_json: '["Actor"]',
          created_at: 10,
          last_refreshed_at: 11,
          hidden_from_recent_at: null,
        },
      ]);
      expect(database.sqlite.prepare("SELECT * FROM library_item_files").all()).toEqual([
        {
          id: "library-1:primary",
          item_id: "library-1",
          root_id: "path-deterministic",
          root_relative_path: "ABC-001/ABC-001.mp4",
          file_name: "ABC-001.mp4",
          directory: "ABC-001",
          size: 123,
          modified_at: 12,
          last_known_path: "ABC-001/ABC-001.mp4",
          created_at: 10,
          updated_at: 11,
        },
      ]);
      expect(database.sqlite.prepare("SELECT * FROM library_item_assets").all()).toEqual([
        {
          id: "asset-1",
          item_id: "library-1",
          kind: "poster",
          uri: "ABC-001/poster.jpg",
          root_id: "path-deterministic",
          relative_path: "ABC-001/poster.jpg",
          created_at: 10,
        },
      ]);
    } finally {
      await migrations.cleanup();
    }
  });
});

describe("MediaRootRepository", () => {
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

  it("always disables a soft-deleted media root", async () => {
    database = createTestPersistenceDatabase();
    const repository = new MediaRootRepository(database);
    const root = createMediaRoot({
      id: "root-deleted",
      displayName: "Deleted",
      hostPath: "/deleted",
      enabled: true,
      now: new Date("2026-08-22T00:00:00.000Z"),
    });

    await expect(repository.upsert({ ...root, deleted: true })).resolves.toMatchObject({
      enabled: false,
      deleted: true,
    });
    await expect(repository.get(root.id, { includeDeleted: true })).resolves.toMatchObject({
      enabled: false,
      deleted: true,
    });
  });

  it("switches the enabled media root atomically while preserving reserved roots", async () => {
    database = createTestPersistenceDatabase();
    const repository = new MediaRootRepository(database);
    const now = new Date("2026-08-22T00:00:00.000Z");
    const metadataRoot = createMediaRoot({
      id: "mdcz-metadata-output",
      displayName: "Metadata",
      hostPath: "/metadata",
      now,
    });
    const firstRoot = createMediaRoot({ id: "path-first", displayName: "First", hostPath: "/first", now });
    const secondRoot = createMediaRoot({ id: "path-second", displayName: "Second", hostPath: "/second", now });
    await repository.upsert(metadataRoot);

    await Promise.all([
      repository.activateExclusive(firstRoot, { exemptRootIds: [metadataRoot.id] }),
      repository.activateExclusive(secondRoot, { exemptRootIds: [metadataRoot.id] }),
    ]);

    const roots = await repository.list();
    expect(roots.filter((root) => root.id !== metadataRoot.id && root.enabled)).toHaveLength(1);
    expect(roots.find((root) => root.id === metadataRoot.id)?.enabled).toBe(true);
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
  it("upserts durable library entries by root path", async () => {
    database = createTestPersistenceDatabase();
    const repository = new LibraryRepository(database);
    const completedAt = new Date("2026-04-30T00:00:00.000Z");
    await repository.upsertEntry({
      rootId: "root-1",
      rootRelativePath: "ABC-123/ABC-123.mp4",
      size: 10,
      sourceRunId: "task-1",
      sourceOutcomeId: "outcome-1",
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
  it("claims a queued task atomically and assigns a new execution version", async () => {
    database = createTestPersistenceDatabase();
    const first = new TaskRepository(database);
    const second = new TaskRepository(database);
    await first.createScanTask({ id: "task-1", rootId: "root-1" });

    const claims = await Promise.all([first.claimNext(), second.claimNext()]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)).toMatchObject({ id: "task-1", status: "running", executionVersion: 1 });
    await expect(first.claimNext()).resolves.toBeNull();
  });

  it("uses status and execution version as the conditional update guard", async () => {
    database = createTestPersistenceDatabase();
    const repository = new TaskRepository(database);
    await repository.createScanTask({ id: "task-1", rootId: "root-1" });
    const claimed = await repository.claimNext();
    expect(claimed).not.toBeNull();

    await expect(
      repository.patch("task-1", { status: "completed" }, { status: "running", executionVersion: 0 }),
    ).resolves.toBeNull();
    await expect(
      repository.patch("task-1", { status: "completed" }, { status: "running", executionVersion: 1 }),
    ).resolves.toMatchObject({ status: "completed", executionVersion: 1 });
  });

  it("invalidates an old worker execution version while requeueing interrupted work", async () => {
    database = createTestPersistenceDatabase();
    const repository = new TaskRepository(database);
    await repository.createScanTask({ id: "task-1", rootId: "root-1" });
    await repository.claimNext();

    await repository.requeueRunning();

    await expect(repository.get("task-1")).resolves.toMatchObject({ status: "queued", executionVersion: 2 });
    await expect(
      repository.patch("task-1", { status: "completed" }, { status: "running", executionVersion: 1 }),
    ).resolves.toBeNull();
  });

  it("commits scan results and terminal summary only for the current execution version", async () => {
    database = createTestPersistenceDatabase();
    const repository = new TaskRepository(database);
    await repository.createScanTask({ id: "task-1", rootId: "root-1" });
    await repository.claimNext();
    await repository.requeueRunning();

    await expect(
      repository.completeScanTask({
        taskId: "task-1",
        rootId: "root-1",
        executionVersion: 1,
        directoryCount: 1,
        results: [{ relativePath: "stale.mp4", size: 1, modifiedAt: null }],
      }),
    ).resolves.toBeNull();
    await expect(repository.listScanResults("task-1")).resolves.toEqual([]);
    await expect(repository.get("task-1")).resolves.toMatchObject({
      status: "queued",
      executionVersion: 2,
      videoCount: 0,
    });
  });

  it("never exposes or mutates non-scan task records", async () => {
    database = createTestPersistenceDatabase();
    database.sqlite
      .prepare("INSERT INTO task_records (id, kind, root_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("legacy-scrape", "scrape", "root-1", "running", 1, 1);
    database.sqlite
      .prepare("INSERT INTO scan_results (task_id, root_id, relative_path, size) VALUES (?, ?, ?, ?)")
      .run("legacy-scrape", "root-1", "stale.mp4", 1);
    const repository = new TaskRepository(database);

    await expect(repository.list()).resolves.toEqual([]);
    await expect(repository.get("legacy-scrape")).rejects.toMatchObject({ code: persistenceErrorCodes.NotFound });
    await expect(repository.patch("legacy-scrape", { status: "completed" })).rejects.toMatchObject({
      code: persistenceErrorCodes.NotFound,
    });
    await expect(
      repository.addEvent({ taskId: "legacy-scrape", type: "failed", message: "hidden" }),
    ).rejects.toMatchObject({ code: persistenceErrorCodes.NotFound });
    await repository.requeueRunning();
    await expect(repository.listAllScanResults()).resolves.toEqual([]);
    expect(database.sqlite.prepare("SELECT status FROM task_records WHERE id = ?").get("legacy-scrape")).toEqual({
      status: "running",
    });
    expect(database.sqlite.prepare("SELECT * FROM task_events WHERE task_id = ?").all("legacy-scrape")).toEqual([]);
  });

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

import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createMediaRoot } from "@mdcz/media-store";
import { afterEach, describe, expect, it } from "vitest";
import { createTempDirectory } from "../../../tests/harness/tempDirectory";

import { createPersistenceDatabase, type PersistenceDatabase } from "./database";
import { PersistenceError, persistenceErrorCodes } from "./errors";
import { LibraryRepository, selectRepresentativeFile } from "./libraryRepository";
import { MediaRootRepository } from "./mediaRootRepository";
import { defaultMigrationsFolder, runMigrations } from "./migrate";
import { ScanTaskRepository } from "./scanTaskRepository";
import { createTestPersistenceDatabase } from "./testDatabase";

let database: PersistenceDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

const addRoots = async (...ids: string[]): Promise<void> => {
  if (!database) throw new Error("Test database is not initialized");
  const roots = new MediaRootRepository(database);
  await Promise.all(ids.map((id) => roots.upsert(createMediaRoot({ id, displayName: id, hostPath: `/${id}` }))));
};

const addSuccessfulOutcomes = (...ids: string[]): void => {
  if (!database) throw new Error("Test database is not initialized");
  database.sqlite
    .prepare("INSERT INTO scrape_runs (id, root_id, execution_mode, created_at) VALUES (?, ?, 'batch', ?)")
    .run("source-run", "root-1", 1);
  const insertItem = database.sqlite.prepare(
    "INSERT INTO scrape_run_items (id, run_id, ordinal, root_id, relative_path) VALUES (?, 'source-run', ?, 'root-1', ?)",
  );
  const insertAttempt = database.sqlite.prepare(
    "INSERT INTO scrape_attempts (id, item_id, attempt, admitted_at) VALUES (?, ?, 1, ?)",
  );
  const insertOutcome = database.sqlite.prepare(
    "INSERT INTO scrape_item_outcomes (id, attempt_id, outcome, completed_at) VALUES (?, ?, 'success', ?)",
  );
  ids.forEach((id, ordinal) => {
    const itemId = `source-item-${ordinal}`;
    const attemptId = `source-attempt-${ordinal}`;
    insertItem.run(itemId, ordinal, `${id}.mp4`);
    insertAttempt.run(attemptId, itemId, 1);
    insertOutcome.run(id, attemptId, 1);
  });
};

const readSchema = (target: PersistenceDatabase) =>
  target.sqlite
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
    .all();

describe("Persistence migrations", () => {
  it("migrates isolated test databases with the package migration facade", () => {
    database = createTestPersistenceDatabase();

    const tables = database.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toContain("media_roots");
    expect(tables).toContain("scan_tasks");
    expect(tables).toContain("scan_task_events");
    expect(tables).toContain("scrape_runs");
    expect(tables).toContain("scrape_run_items");
    expect(tables).toContain("scrape_item_outcomes");
    expect(tables).toContain("library_items");
    expect(tables).toContain("library_item_files");
    expect(tables).toContain("library_item_assets");
    expect(tables).toContain("__drizzle_migrations");
    expect(tables).not.toContain("maintenance_directory_tasks");

    const indexes = database.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        "library_item_assets_item_idx",
        "library_item_assets_output_idx",
        "library_item_files_root_path_idx",
        "library_item_files_source_outcome_idx",
        "scan_results_task_root_path_idx",
        "scan_tasks_queue_idx",
        "scan_task_events_task_created_at_idx",
      ]),
    );
  });

  it("configures SQLite for bounded WAL concurrency", () => {
    database = createTestPersistenceDatabase();

    expect(database.sqlite.pragma("journal_mode", { simple: true })).toBe("memory");
    expect(database.sqlite.pragma("busy_timeout", { simple: true })).toBe(5000);
    expect(database.sqlite.pragma("synchronous", { simple: true })).toBe(2);
  });

  it("resets the legacy library index while preserving roots, scans, and scrape history", async () => {
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

      for (const name of [
        "0001_task_execution_and_media_root_identity.sql",
        "0002_legacy_012_bridge.sql",
        "0003_additive_roots_and_scan_tasks.sql",
      ]) {
        await cp(join(defaultMigrationsFolder, name), join(migrations.path, name));
      }
      await writeFile(
        join(migrations.path, "meta", "_journal.json"),
        JSON.stringify({ ...journal, entries: journal.entries.filter((entry) => entry.idx <= 3) }),
      );
      runMigrations(database, { migrationsFolder: migrations.path });
      database.sqlite.exec(`
        INSERT INTO scrape_runs (id, root_id, execution_mode, created_at)
        VALUES ('scrape-run-1', 'path-deterministic', 'single', 20);
        INSERT INTO scrape_run_items (id, run_id, ordinal, root_id, relative_path)
        VALUES ('scrape-item-1', 'scrape-run-1', 0, 'path-deterministic', 'ABC-001.mp4');
        INSERT INTO scrape_attempts (id, item_id, attempt, admitted_at)
        VALUES ('scrape-attempt-1', 'scrape-item-1', 1, 20);
        INSERT INTO scrape_item_outcomes (id, attempt_id, outcome, completed_at)
        VALUES ('scrape-outcome-1', 'scrape-attempt-1', 'success', 21);
      `);
      for (const name of ["0004_publication_and_directory_tasks.sql", "0005_movie_file_model.sql"]) {
        await cp(join(defaultMigrationsFolder, name), join(migrations.path, name));
      }
      await writeFile(
        join(migrations.path, "meta", "_journal.json"),
        JSON.stringify({ ...journal, entries: journal.entries.filter((entry) => entry.idx <= 5) }),
      );
      runMigrations(database, { migrationsFolder: migrations.path });
      database.sqlite.exec(`
        INSERT INTO maintenance_directory_tasks (id, snapshot_json, configuration_json, updated_at)
        VALUES ('maintenance-1', '{}', '{}', 1);
      `);
      runMigrations(database);
      runMigrations(database);
      expect(
        database.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'maintenance_directory_tasks'").all(),
      ).toEqual([]);
      expect(database.sqlite.prepare("SELECT count(*) AS count FROM __drizzle_migrations").get()).toEqual({ count: 7 });

      expect(
        database.sqlite.prepare("SELECT task_id, root_id, relative_path, size, modified_at FROM scan_results").all(),
      ).toEqual([{ task_id: "task-1", root_id: "root-1", relative_path: "ABC-001.mp4", size: 20, modified_at: 200 }]);
      expect(() => insertScanResult.run("task-1", "root-1", "ABC-001.mp4", 30, null)).toThrow(
        /UNIQUE constraint failed/u,
      );
      expect(database.sqlite.prepare("SELECT id, root_id, status FROM scan_tasks WHERE id = ?").get("task-1")).toEqual({
        id: "task-1",
        root_id: "root-1",
        status: "queued",
      });
      expect(database.sqlite.prepare("SELECT id FROM media_roots ORDER BY id").all()).toEqual([
        { id: "123e4567-e89b-12d3-a456-426614174000" },
        { id: "mdcz-metadata-output" },
        { id: "path-deterministic" },
      ]);
      expect(database.sqlite.prepare("SELECT id, outcome FROM scrape_item_outcomes").all()).toEqual([
        { id: "scrape-outcome-1", outcome: "success" },
      ]);
      expect(database.sqlite.prepare("SELECT * FROM library_items").all()).toEqual([]);
      expect(database.sqlite.prepare("SELECT * FROM library_item_files").all()).toEqual([]);
      expect(database.sqlite.prepare("SELECT * FROM library_item_assets").all()).toEqual([]);
    } finally {
      await migrations.cleanup();
    }
  });

  it("upgrades a released v0.12 database through the compatibility bridge", async () => {
    const migrations = await createTempDirectory("persistence-v012-migrations");
    try {
      await mkdir(join(migrations.path, "meta"), { recursive: true });
      await Promise.all(
        ["0000_initial.sql", "0001_task_execution_and_media_root_identity.sql"].map((file) =>
          cp(join(defaultMigrationsFolder, file), join(migrations.path, file)),
        ),
      );
      const journal = JSON.parse(await readFile(join(defaultMigrationsFolder, "meta", "_journal.json"), "utf8")) as {
        entries: Array<{ idx: number }>;
      };
      await writeFile(
        join(migrations.path, "meta", "_journal.json"),
        JSON.stringify({ ...journal, entries: journal.entries.filter((entry) => entry.idx <= 1) }),
      );

      database = createPersistenceDatabase({ path: ":memory:" });
      runMigrations(database, { migrationsFolder: migrations.path });
      database.sqlite
        .prepare(
          "INSERT INTO media_roots (id, display_name, host_path, root_type, enabled, deleted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run("root-1", "Media", "/media", "mounted-filesystem", 1, 0, 1, 1);
      database.sqlite
        .prepare(
          "INSERT INTO task_records (id, kind, root_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("scan-1", "scan", "root-1", "completed", 2, 3);
      database.sqlite
        .prepare("INSERT INTO scan_results (task_id, root_id, relative_path, size, modified_at) VALUES (?, ?, ?, ?, ?)")
        .run("scan-1", "root-1", "movie.mp4", 20, 2);

      runMigrations(database);
      runMigrations(database);

      expect(database.sqlite.prepare("SELECT count(*) AS count FROM __drizzle_migrations").get()).toEqual({ count: 7 });
      expect(database.sqlite.prepare("SELECT id, root_id, status FROM scan_tasks").all()).toEqual([
        { id: "scan-1", root_id: "root-1", status: "completed" },
      ]);
      expect(database.sqlite.prepare("SELECT task_id, root_id, relative_path, size FROM scan_results").all()).toEqual([
        { task_id: "scan-1", root_id: "root-1", relative_path: "movie.mp4", size: 20 },
      ]);
      expect(database.sqlite.prepare("PRAGMA integrity_check").pluck().all()).toEqual(["ok"]);
      expect(database.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

      const indexes = database.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
        .pluck()
        .all();
      expect(indexes).toContain("scan_task_events_task_created_at_idx");
      expect(indexes).not.toContain("task_events_task_created_at_idx");

      const fresh = createTestPersistenceDatabase();
      try {
        expect(readSchema(database)).toEqual(readSchema(fresh));
      } finally {
        fresh.close();
      }
    } finally {
      await migrations.cleanup();
    }
  });

  it("accepts the released v0.15 migration record without replaying it", async () => {
    const migrations = await createTempDirectory("persistence-v015-migrations");
    try {
      await mkdir(join(migrations.path, "meta"), { recursive: true });
      await cp(join(defaultMigrationsFolder, "0000_initial.sql"), join(migrations.path, "0000_initial.sql"));
      await cp(
        join(defaultMigrationsFolder, "0003_additive_roots_and_scan_tasks.sql"),
        join(migrations.path, "0001_additive_roots_and_scan_tasks.sql"),
      );
      await writeFile(
        join(migrations.path, "meta", "_journal.json"),
        JSON.stringify({
          version: "7",
          dialect: "sqlite",
          entries: [
            { idx: 0, version: "7", when: 0, tag: "0000_initial", breakpoints: true },
            {
              idx: 1,
              version: "7",
              when: 1_787_875_200_000,
              tag: "0001_additive_roots_and_scan_tasks",
              breakpoints: true,
            },
          ],
        }),
      );

      database = createPersistenceDatabase({ path: ":memory:" });
      runMigrations(database, { migrationsFolder: migrations.path });
      runMigrations(database);

      expect(database.sqlite.prepare("SELECT count(*) AS count FROM __drizzle_migrations").get()).toEqual({ count: 5 });
      const fresh = createTestPersistenceDatabase();
      try {
        expect(readSchema(database)).toEqual(readSchema(fresh));
      } finally {
        fresh.close();
      }
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

    await repository.upsert(root);

    await expect(repository.get("root-1")).resolves.toEqual(root);
    await expect(repository.list()).resolves.toEqual([root]);
  });

  it("reuses the enclosing root for a nested path", async () => {
    database = createTestPersistenceDatabase();
    const repository = new MediaRootRepository(database);
    const root = createMediaRoot({
      id: "root-parent",
      displayName: "Parent",
      hostPath: "/media",
      now: new Date("2026-08-22T00:00:00.000Z"),
    });

    await repository.upsert(root);
    await expect(repository.ensurePath("/media/child")).resolves.toEqual(root);
  });

  it("coalesces concurrent registrations for the same host path", async () => {
    database = createTestPersistenceDatabase();
    const first = new MediaRootRepository(database);
    const second = new MediaRootRepository(database);
    const roots = await Promise.all([first.ensurePath("/first", "First"), second.ensurePath("/first", "Second")]);

    expect(roots[0].id).toBe(roots[1].id);
    await expect(first.list()).resolves.toEqual([roots[0]]);
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
  it.each([
    {
      files: [
        { id: "part-2", partNumber: 2, resolution: "4K" },
        { id: "part-1", partNumber: 1, resolution: "1080p" },
      ],
      expected: "part-1",
    },
    {
      files: [
        { id: "1080", partNumber: null, resolution: "1080p" },
        { id: "4k", partNumber: null, resolution: "4K" },
      ],
      expected: "4k",
    },
    {
      files: [
        { id: "b", partNumber: null, resolution: "2160P" },
        { id: "a", partNumber: null, resolution: "4k" },
      ],
      expected: "a",
    },
  ])("selects a stable representative file ($expected)", ({ files, expected }) => {
    const candidates = files as Array<{ id: string; partNumber: number | null; resolution: string | null }>;
    expect(selectRepresentativeFile(candidates)?.id).toBe(expected);
    expect(selectRepresentativeFile([...candidates].reverse())?.id).toBe(expected);
  });

  it("upserts durable library entries by root path", async () => {
    database = createTestPersistenceDatabase();
    await addRoots("root-1");
    const repository = new LibraryRepository(database);
    const completedAt = new Date("2026-04-30T00:00:00.000Z");
    await repository.upsertEntry({
      rootId: "root-1",
      rootRelativePath: "ABC-123/ABC-123.mp4",
      size: 10,
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
        files: [expect.objectContaining({ rootRelativePath: "ABC-123/ABC-123.mp4" })],
        size: 11,
        actors: [],
        crawlerDataJson: null,
      }),
    ]);
  });

  it("loads library entries for source outcome ids in one query", async () => {
    database = createTestPersistenceDatabase();
    await addRoots("root-1");
    addSuccessfulOutcomes("outcome-1", "outcome-2");
    const repository = new LibraryRepository(database);
    await repository.upsertEntry({
      id: "entry-1",
      rootId: "root-1",
      rootRelativePath: "A.mp4",
      sourceOutcomeId: "outcome-1",
      assets: [{ kind: "poster", uri: "A.jpg", rootId: "root-1", relativePath: "A.jpg" }],
    });
    await repository.upsertEntry({
      id: "entry-2",
      rootId: "root-1",
      rootRelativePath: "B.mp4",
      sourceOutcomeId: "outcome-2",
    });

    const entries = await repository.getEntriesBySourceOutcomeIds(["outcome-1", "outcome-2", "missing"]);
    expect([...entries.keys()].sort()).toEqual(["outcome-1", "outcome-2"]);
    expect(entries.get("outcome-1")).toMatchObject({
      id: "entry-1",
      assets: [expect.objectContaining({ kind: "poster", uri: "A.jpg" })],
    });
    await expect(repository.getEntryBySourceOutcomeId("outcome-2")).resolves.toMatchObject({ id: "entry-2" });
    await expect(repository.getEntryBySourceOutcomeId("missing")).resolves.toBeNull();
    await expect(repository.getEntriesBySourceOutcomeIds([])).resolves.toEqual(new Map());
  });

  it("paginates library entries with a stable created-at and id cursor", async () => {
    database = createTestPersistenceDatabase();
    await addRoots("root-1", "root-2");
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
    await addRoots("root-1", "root-2");
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

  it("includes all registered roots and treats LIKE metacharacters literally", async () => {
    database = createTestPersistenceDatabase();
    const repository = new LibraryRepository(database);
    const roots = new MediaRootRepository(database);
    const now = new Date("2026-05-01T00:00:00.000Z");
    await roots.upsert(createMediaRoot({ id: "active-root", displayName: "Active", hostPath: "/active", now }));
    await roots.upsert(createMediaRoot({ id: "deleted-root", displayName: "Deleted", hostPath: "/deleted", now }));
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
      total: 2,
      hasMore: true,
    });
    await expect(repository.listEntriesPage({ limit: 10, query: "%" })).resolves.toMatchObject({
      entries: [expect.objectContaining({ id: "active-entry" })],
      total: 1,
    });
  });

  it("prefers poster assets for library row artwork", async () => {
    database = createTestPersistenceDatabase();
    await addRoots("root-1");
    const repository = new LibraryRepository(database);

    await repository.upsertEntry({
      rootId: "root-1",
      rootRelativePath: "ABC-123/ABC-123.mp4",
      crawlerDataJson: JSON.stringify({
        thumb_url: "ABC-123/thumb.jpg",
        poster_url: "ABC-123/poster.jpg",
      }),
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

  it("relinks a stable library file without retaining the old path", async () => {
    database = createTestPersistenceDatabase();
    await addRoots("root-1");
    const repository = new LibraryRepository(database);
    const entry = await repository.upsertEntry({
      id: "entry-1",
      rootId: "root-1",
      rootRelativePath: "old/ABC-123.mp4",
      size: 10,
    });

    await repository.relinkFile({
      fileId: entry.files[0].id,
      rootId: "root-1",
      rootRelativePath: "new/ABC-123-流出.mp4",
      size: 11,
    });

    await expect(repository.getEntryById("entry-1")).resolves.toMatchObject({
      size: 11,
      files: [expect.objectContaining({ rootRelativePath: "new/ABC-123-流出.mp4" })],
    });
    await expect(repository.getEntry("root-1", "old/ABC-123.mp4")).rejects.toThrow("Library entry not found");
  });

  it("rejects an asset file reference owned by a different movie", async () => {
    database = createTestPersistenceDatabase();
    await addRoots("root-1");
    const repository = new LibraryRepository(database);
    await repository.upsertEntry({ id: "entry-1", rootId: "root-1", rootRelativePath: "A.mp4" });
    const second = await repository.upsertEntry({ id: "entry-2", rootId: "root-1", rootRelativePath: "B.mp4" });

    expect(() =>
      database?.sqlite
        .prepare(
          "INSERT INTO library_item_assets (id, item_id, file_id, kind, uri, published, historical, created_at) VALUES (?, ?, ?, 'strm', ?, 0, 0, ?)",
        )
        .run("bad-asset", "entry-1", second.files[0].id, "B.strm", 1),
    ).toThrow(/FOREIGN KEY constraint failed/u);
  });

  it("retains file-specific assets when another file is added to the movie", async () => {
    database = createTestPersistenceDatabase();
    await addRoots("root-1");
    const repository = new LibraryRepository(database);
    await repository.upsertEntry({
      id: "entry-1",
      fileId: "file-1",
      rootId: "root-1",
      rootRelativePath: "ABC-123-CD1.mp4",
      size: 10,
      partNumber: 1,
      partSuffix: "CD1",
      assets: [{ kind: "strm", uri: "ABC-123-CD1.strm", rootId: "root-1", relativePath: "ABC-123-CD1.strm" }],
    });
    const firstAssetId = (await repository.getEntryById("entry-1")).assets[0]?.id;
    await repository.upsertEntry({
      id: "entry-1",
      fileId: "file-2",
      rootId: "root-1",
      rootRelativePath: "ABC-123-CD2.mp4",
      size: 20,
      partNumber: 2,
      partSuffix: "CD2",
      assets: [{ kind: "strm", uri: "ABC-123-CD2.strm", rootId: "root-1", relativePath: "ABC-123-CD2.strm" }],
    });

    const entry = await repository.getEntryById("entry-1");
    expect(entry).toMatchObject({
      displayFileId: "file-1",
      size: 30,
      files: [expect.objectContaining({ id: "file-1" }), expect.objectContaining({ id: "file-2" })],
    });
    expect(entry.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileId: "file-1" }),
        expect.objectContaining({ fileId: "file-2" }),
      ]),
    );
    expect(entry.assets.find((asset) => asset.fileId === "file-1")?.id).toBe(firstAssetId);
    await expect(repository.getOverviewSummary(10)).resolves.toMatchObject({
      fileCount: 2,
      totalBytes: 30,
      recentEntries: [expect.objectContaining({ id: "entry-1", size: 30 })],
    });
  });

  it("hides entries from recent acquisitions without deleting the library item", async () => {
    database = createTestPersistenceDatabase();
    await addRoots("root-1");
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
    await addRoots("root-1");
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
        files: [expect.objectContaining({ rootRelativePath: "DEF-456/DEF-456.mp4" })],
      }),
    ]);
  });
});

describe("ScanTaskRepository", () => {
  it("claims an explicitly queued task atomically", async () => {
    database = createTestPersistenceDatabase();
    const first = new ScanTaskRepository(database);
    const second = new ScanTaskRepository(database);
    await first.create({ id: "task-1", rootId: "root-1" });

    const claims = await Promise.all([first.claim("task-1"), second.claim("task-1")]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)).toMatchObject({ id: "task-1", status: "running" });
    await expect(first.claim("task-1")).resolves.toBeNull();
  });

  it("requeues terminal tasks atomically", async () => {
    database = createTestPersistenceDatabase();
    const repository = new ScanTaskRepository(database);
    await repository.create({ id: "task-1", rootId: "root-1" });
    const claimed = await repository.claim("task-1");
    expect(claimed).not.toBeNull();

    await repository.complete({ taskId: "task-1", rootId: "root-1", directoryCount: 0, results: [] });
    await expect(repository.requeue("task-1")).resolves.toMatchObject({ status: "queued", videoCount: 0 });
  });

  it("commits scan results only for a running task", async () => {
    database = createTestPersistenceDatabase();
    const repository = new ScanTaskRepository(database);
    await repository.create({ id: "task-1", rootId: "root-1" });

    await expect(
      repository.complete({
        taskId: "task-1",
        rootId: "root-1",
        directoryCount: 1,
        results: [{ relativePath: "stale.mp4", size: 1, modifiedAt: null }],
      }),
    ).resolves.toBeNull();
    await expect(repository.listScanResults("task-1")).resolves.toEqual([]);
    await repository.claim("task-1");
    await expect(
      repository.complete({
        taskId: "task-1",
        rootId: "root-1",
        directoryCount: 1,
        results: [{ relativePath: "fresh.mp4", size: 1, modifiedAt: null }],
      }),
    ).resolves.toMatchObject({ status: "completed", videoCount: 1 });
  });

  it("rejects duplicate scan paths within one task and root", async () => {
    database = createTestPersistenceDatabase();
    const repository = new ScanTaskRepository(database);
    const duplicate = { relativePath: "ABC-123.mp4", size: 10, modifiedAt: null };
    await repository.create({ id: "task-1", rootId: "root-1" });
    await repository.claim("task-1");

    await expect(
      repository.complete({
        taskId: "task-1",
        rootId: "root-1",
        directoryCount: 1,
        results: [duplicate, duplicate],
      }),
    ).rejects.toMatchObject({
      code: persistenceErrorCodes.ConstraintViolation,
      message: "Duplicate scan result path for task task-1: ABC-123.mp4",
    });
  });
});

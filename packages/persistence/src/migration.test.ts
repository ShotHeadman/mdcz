import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createPersistenceDatabase } from "./database";
import { defaultMigrationsFolder } from "./migrate";
import { createTestPersistenceDatabase } from "./testDatabase";

const publishedBaselineChecksum = "5ac9842c4940bfb7571562f68b5ad978000534f89b67bf6525907baf098f40ff";

describe("Persistence migration baseline", () => {
  it("keeps the released baseline byte-for-byte intact", async () => {
    const contents = await readFile(join(defaultMigrationsFolder, "0000_initial.sql"));
    expect(createHash("sha256").update(contents).digest("hex")).toBe(publishedBaselineChecksum);
  });

  it("keeps exactly the published baseline and one unreleased consolidated migration", async () => {
    const journal = JSON.parse(await readFile(join(defaultMigrationsFolder, "meta", "_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; when: number; tag: string }>;
    };
    const migrationFiles = (await readdir(defaultMigrationsFolder))
      .filter((entry) => /^\d{4}_.+\.sql$/u.test(entry))
      .sort();

    expect(journal.entries).toEqual([
      expect.objectContaining({ idx: 0, when: 0, tag: "0000_initial" }),
      expect.objectContaining({ idx: 1, when: 1_787_424_000_000 }),
    ]);
    expect(migrationFiles).toEqual(["0000_initial.sql", "0001_task_execution_and_media_root_identity.sql"]);
  });

  it("creates the complete terminal scrape aggregate in a fresh database", () => {
    const database = createTestPersistenceDatabase();
    try {
      const tables = database.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name);
      expect(tables).toEqual(
        expect.arrayContaining(["scrape_runs", "scrape_run_items", "scrape_item_outcomes", "library_repair_issues"]),
      );
      expect(tables).not.toContain("scrape_run_summaries");
      expect(tables).not.toContain("maintenance_previews");
      expect(tables).not.toContain("maintenance_apply_log");

      const runColumns = database.sqlite
        .prepare("PRAGMA table_info(scrape_runs)")
        .all()
        .map((row) => (row as { name: string }).name);
      expect(runColumns).toEqual([
        "id",
        "root_id",
        "output_root_id",
        "execution_mode",
        "retry_of_run_id",
        "created_at",
        "started_at",
        "completed_at",
        "disposition",
        "error_message",
      ]);
      expect(runColumns).not.toContain("status");

      const itemColumns = database.sqlite
        .prepare("PRAGMA table_info(scrape_run_items)")
        .all()
        .map((row) => (row as { name: string }).name);
      expect(itemColumns).not.toContain("status");

      const outcomeColumns = database.sqlite
        .prepare("PRAGMA table_info(scrape_item_outcomes)")
        .all()
        .map((row) => (row as { name: string }).name);
      expect(outcomeColumns).toContain("outcome");
      expect(outcomeColumns).not.toContain("attempt");
      expect(outcomeColumns).not.toContain("status");
    } finally {
      database.close();
    }
  });

  it("deletes legacy scrape history while preserving media, library, and scan facts", async () => {
    const database = createPersistenceDatabase({ path: ":memory:" });
    try {
      database.sqlite.exec(await readFile(join(defaultMigrationsFolder, "0000_initial.sql"), "utf8"));
      database.sqlite
        .prepare(
          `INSERT INTO media_roots
            (id, display_name, host_path, root_type, enabled, deleted, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("root-1", "Media", "/media", "media", 1, 0, 100, 200);
      database.sqlite
        .prepare(
          `INSERT INTO library_items
            (id, media_identity, crawler_data_json, source_task_id, scrape_output_id, title, number, actors_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "item-1",
          "ABC-001",
          '{"number":"ABC-001"}',
          "scrape-task",
          "output-1",
          "Title",
          "ABC-001",
          '["Actor"]',
          300,
        );
      database.sqlite
        .prepare(
          `INSERT INTO library_item_files
            (id, item_id, root_id, root_relative_path, file_name, directory, size, modified_at, last_known_path, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "file-1",
          "item-1",
          "root-1",
          "ABC-001.mp4",
          "ABC-001.mp4",
          ".",
          4096,
          400,
          "/media/ABC-001.mp4",
          500,
          600,
        );
      database.sqlite
        .prepare(
          `INSERT INTO library_item_assets
            (id, item_id, kind, uri, root_id, relative_path, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("asset-1", "item-1", "poster", "ABC-001-poster.jpg", "root-1", "ABC-001-poster.jpg", 700);

      const insertTask = database.sqlite.prepare(
        `INSERT INTO task_records
          (id, kind, root_id, status, summary, created_at, updated_at, started_at, completed_at, error_message, video_count, directory_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insertTask.run("scan-task", "scan", "root-1", "queued", "scan", 800, 801, null, null, null, 1, 2);
      insertTask.run("scrape-task", "scrape", "root-1", "completed", "scrape", 810, 811, 812, 813, null, 1, 0);
      insertTask.run(
        "maintenance-task",
        "maintenance",
        "root-1",
        "failed",
        "maintenance",
        820,
        821,
        822,
        823,
        "failed",
        1,
        0,
      );
      const insertEvent = database.sqlite.prepare(
        "INSERT INTO task_events (id, task_id, type, message, created_at) VALUES (?, ?, ?, ?, ?)",
      );
      insertEvent.run("scan-event", "scan-task", "queued", "scan queued", 900);
      insertEvent.run("scrape-event", "scrape-task", "completed", "scrape completed", 901);
      insertEvent.run("maintenance-event", "maintenance-task", "failed", "maintenance failed", 902);
      const insertScanResult = database.sqlite.prepare(
        "INSERT INTO scan_results (task_id, root_id, relative_path, size, modified_at) VALUES (?, ?, ?, ?, ?)",
      );
      insertScanResult.run("scan-task", "root-1", "ABC-001.mp4", 4096, 400);
      insertScanResult.run("scrape-task", "root-1", "stale-scrape.mp4", 2048, 401);
      insertScanResult.run("maintenance-task", "root-1", "stale-maintenance.mp4", 1024, 402);
      database.sqlite
        .prepare(
          `INSERT INTO scrape_outputs
            (id, task_id, root_id, output_directory, file_count, total_bytes, completed_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("output-1", "scrape-task", "root-1", ".", 1, 4096, 813, 810);
      database.sqlite
        .prepare(
          `INSERT INTO scrape_results
            (id, task_id, root_id, relative_path, status, crawler_data_json, output_relative_path, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "result-1",
          "scrape-task",
          "root-1",
          "ABC-001.mp4",
          "success",
          '{"number":"ABC-001"}',
          "ABC-001.mp4",
          810,
          813,
        );
      database.sqlite
        .prepare(
          `INSERT INTO library_entries
            (id, root_id, root_relative_path, file_name, directory, size, source_task_id, scrape_output_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("legacy-entry", "root-1", "ABC-001.mp4", "ABC-001.mp4", ".", 4096, "scrape-task", "output-1", 300);

      database.sqlite.exec(
        await readFile(join(defaultMigrationsFolder, "0001_task_execution_and_media_root_identity.sql"), "utf8"),
      );

      const tables = database.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name);
      expect(tables).toEqual(expect.arrayContaining(["scrape_runs", "scrape_run_items", "scrape_item_outcomes"]));
      expect(tables).not.toEqual(expect.arrayContaining(["scrape_results", "scrape_outputs", "library_entries"]));
      expect(database.sqlite.prepare("SELECT * FROM task_records ORDER BY id").all()).toEqual([
        {
          id: "scan-task",
          kind: "scan",
          root_id: "root-1",
          status: "queued",
          summary: "scan",
          created_at: 800,
          updated_at: 801,
          started_at: null,
          completed_at: null,
          error_message: null,
          video_count: 1,
          directory_count: 2,
          execution_version: 0,
        },
      ]);
      expect(database.sqlite.prepare("SELECT * FROM task_events ORDER BY id").all()).toEqual([
        { id: "scan-event", task_id: "scan-task", type: "queued", message: "scan queued", created_at: 900 },
      ]);
      expect(database.sqlite.prepare("SELECT * FROM scan_results").all()).toEqual([
        { task_id: "scan-task", root_id: "root-1", relative_path: "ABC-001.mp4", size: 4096, modified_at: 400 },
      ]);
      expect(database.sqlite.prepare("SELECT * FROM media_roots").all()).toEqual([
        {
          id: "root-1",
          display_name: "Media",
          host_path: "/media",
          root_type: "media",
          enabled: 1,
          deleted: 0,
          created_at: 100,
          updated_at: 200,
        },
      ]);
      expect(database.sqlite.prepare("SELECT * FROM library_items").all()).toEqual([
        {
          id: "item-1",
          media_identity: "ABC-001",
          crawler_data_json: '{"number":"ABC-001"}',
          source_run_id: null,
          source_outcome_id: null,
          title: "Title",
          number: "ABC-001",
          actors_json: '["Actor"]',
          created_at: 300,
          last_refreshed_at: null,
          hidden_from_recent_at: null,
        },
      ]);
      expect(database.sqlite.prepare("SELECT * FROM library_item_files").all()).toEqual([
        {
          id: "file-1",
          item_id: "item-1",
          root_id: "root-1",
          root_relative_path: "ABC-001.mp4",
          file_name: "ABC-001.mp4",
          directory: ".",
          size: 4096,
          modified_at: 400,
          last_known_path: "/media/ABC-001.mp4",
          created_at: 500,
          updated_at: 600,
        },
      ]);
      expect(database.sqlite.prepare("SELECT * FROM library_item_assets").all()).toEqual([
        {
          id: "asset-1",
          item_id: "item-1",
          kind: "poster",
          uri: "ABC-001-poster.jpg",
          root_id: "root-1",
          relative_path: "ABC-001-poster.jpg",
          created_at: 700,
        },
      ]);
    } finally {
      database.close();
    }
  });

  it("rolls back a failed 0001 so the baseline is left intact", async () => {
    const database = createPersistenceDatabase({ path: ":memory:" });
    try {
      database.sqlite.exec(await readFile(join(defaultMigrationsFolder, "0000_initial.sql"), "utf8"));
      database.sqlite
        .prepare(
          `INSERT INTO media_roots
            (id, display_name, host_path, root_type, enabled, deleted, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("root-1", "Media", "/media", "media", 1, 0, 100, 200);
      const before = database.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
      const sql = (
        await readFile(join(defaultMigrationsFolder, "0001_task_execution_and_media_root_identity.sql"), "utf8")
      )
        .replaceAll("--> statement-breakpoint", "")
        .concat("\nSELECT * FROM __mdcz_0001_should_not_exist;\n");
      database.sqlite.exec("BEGIN");
      expect(() => database.sqlite.exec(sql)).toThrow();
      database.sqlite.exec("ROLLBACK");
      expect(
        database.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all(),
      ).toEqual(before);
      expect(database.sqlite.prepare("SELECT id FROM media_roots").all()).toEqual([{ id: "root-1" }]);
    } finally {
      database.close();
    }
  });

  it("keeps the newest duplicate scan result and preserves disabled or deleted roots", async () => {
    const database = createPersistenceDatabase({ path: ":memory:" });
    try {
      database.sqlite.exec(await readFile(join(defaultMigrationsFolder, "0000_initial.sql"), "utf8"));
      const insertRoot = database.sqlite.prepare(
        `INSERT INTO media_roots
          (id, display_name, host_path, root_type, enabled, deleted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insertRoot.run("root-live", "Live", "/media", "media", 1, 0, 100, 200);
      insertRoot.run("root-disabled", "Disabled", "/disabled", "media", 0, 0, 101, 201);
      insertRoot.run("root-deleted", "Deleted", "/deleted", "media", 1, 1, 102, 202);
      database.sqlite
        .prepare(
          `INSERT INTO task_records
            (id, kind, root_id, status, summary, created_at, updated_at, started_at, completed_at, error_message, video_count, directory_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("scan-task", "scan", "root-live", "completed", "scan", 800, 801, 802, 803, null, 1, 0);
      const insertScan = database.sqlite.prepare(
        "INSERT INTO scan_results (task_id, root_id, relative_path, size, modified_at) VALUES (?, ?, ?, ?, ?)",
      );
      insertScan.run("scan-task", "root-live", "ABC-001.mp4", 100, 10);
      insertScan.run("scan-task", "root-live", "ABC-001.mp4", 200, 20);
      insertScan.run("scan-task", "root-live", "ABC-001.mp4", 300, 20);
      database.sqlite.exec(
        (
          await readFile(join(defaultMigrationsFolder, "0001_task_execution_and_media_root_identity.sql"), "utf8")
        ).replaceAll("--> statement-breakpoint", ""),
      );
      expect(database.sqlite.prepare("SELECT size, modified_at FROM scan_results").all()).toEqual([
        { size: 300, modified_at: 20 },
      ]);
      expect(database.sqlite.prepare("SELECT id, enabled, deleted FROM media_roots ORDER BY id").all()).toEqual([
        { id: "root-deleted", enabled: 1, deleted: 1 },
        { id: "root-disabled", enabled: 0, deleted: 0 },
        { id: "root-live", enabled: 1, deleted: 0 },
      ]);
    } finally {
      database.close();
    }
  });
});

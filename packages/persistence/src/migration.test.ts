import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPersistenceDatabase } from "./database";
import { defaultMigrationsFolder } from "./migrate";
import { createTestPersistenceDatabase } from "./testDatabase";

const baselineChecksum = "5ac9842c4940bfb7571562f68b5ad978000534f89b67bf6525907baf098f40ff";
const migrationFile = "0001_additive_roots_and_scan_tasks.sql";

describe("Persistence migration baseline", () => {
  it("keeps the released baseline byte-for-byte intact", async () => {
    const contents = await readFile(join(defaultMigrationsFolder, "0000_initial.sql"));
    expect(createHash("sha256").update(contents).digest("hex")).toBe(baselineChecksum);
  });

  it("keeps exactly the baseline and the retagged unreleased migration", async () => {
    const journal = JSON.parse(await readFile(join(defaultMigrationsFolder, "meta", "_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; when: number; tag: string }>;
    };
    const files = (await readdir(defaultMigrationsFolder)).filter((entry) => /^\d{4}_.+\.sql$/u.test(entry)).sort();

    expect(journal.entries).toEqual([
      expect.objectContaining({ idx: 0, when: 0, tag: "0000_initial" }),
      expect.objectContaining({ idx: 1, when: 1_787_875_200_000, tag: "0001_additive_roots_and_scan_tasks" }),
    ]);
    expect(files).toEqual(["0000_initial.sql", migrationFile]);
  });

  it("creates the strict journal, attempt, and library target schema", () => {
    const database = createTestPersistenceDatabase();
    try {
      const tables = database.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name);
      expect(tables).toEqual(
        expect.arrayContaining(["publication_journal", "scrape_attempts", "scrape_item_outcomes"]),
      );

      const columns = (table: string) =>
        database.sqlite
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((row) => (row as { name: string }).name);
      expect(columns("scrape_runs")).not.toContain("retry_of_run_id");
      expect(columns("scan_tasks")).not.toEqual(expect.arrayContaining(["kind", "summary", "execution_version"]));
      expect(columns("scrape_item_outcomes")).toContain("attempt_id");
      expect(columns("scrape_item_outcomes")).not.toContain("item_id");

      const strict = database.sqlite.prepare("PRAGMA table_list").all() as Array<{ name: string; strict: number }>;
      for (const name of [
        "publication_journal",
        "scrape_attempts",
        "scrape_item_outcomes",
        "library_items",
        "library_item_files",
        "library_item_assets",
      ]) {
        expect(strict.find((table) => table.name === name)?.strict).toBe(1);
      }

      const foreignKeys = (table: string) =>
        (
          database.sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{
            table: string;
            on_delete: string;
          }>
        ).map((key) => `${key.table}:${key.on_delete}`);
      expect(foreignKeys("library_item_files")).toEqual(
        expect.arrayContaining(["library_items:CASCADE", "media_roots:RESTRICT"]),
      );
      expect(foreignKeys("library_item_assets")).toEqual(
        expect.arrayContaining(["library_items:CASCADE", "media_roots:RESTRICT"]),
      );
    } finally {
      database.close();
    }
  });

  it("preserves scan and library facts while discarding obsolete generic tasks", async () => {
    const database = createPersistenceDatabase({ path: ":memory:" });
    try {
      database.sqlite.exec(await readFile(join(defaultMigrationsFolder, "0000_initial.sql"), "utf8"));
      database.sqlite
        .prepare(
          "INSERT INTO media_roots (id, display_name, host_path, root_type, enabled, deleted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run("root-1", "Media", "/media", "mounted-filesystem", 1, 0, 1, 1);
      const insertTask = database.sqlite.prepare(
        "INSERT INTO task_records (id, kind, root_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      );
      insertTask.run("scan-1", "scan", "root-1", "completed", 2, 3);
      insertTask.run("legacy-scrape", "scrape", "root-1", "completed", 2, 3);
      const insertResult = database.sqlite.prepare(
        "INSERT INTO scan_results (task_id, root_id, relative_path, size, modified_at) VALUES (?, ?, ?, ?, ?)",
      );
      insertResult.run("scan-1", "root-1", "movie.mp4", 10, 1);
      insertResult.run("scan-1", "root-1", "movie.mp4", 20, 2);
      insertResult.run("legacy-scrape", "root-1", "stale.mp4", 1, 1);
      database.sqlite
        .prepare("INSERT INTO library_items (id, actors_json, created_at) VALUES (?, ?, ?)")
        .run("item-1", "[]", 4);
      database.sqlite
        .prepare(
          "INSERT INTO library_item_files (id, item_id, root_id, root_relative_path, file_name, directory, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run("file-1", "item-1", "root-1", "movie.mp4", "movie.mp4", "", 20, 4, 4);

      database.sqlite.exec(await readFile(join(defaultMigrationsFolder, migrationFile), "utf8"));

      expect(database.sqlite.prepare("SELECT id, root_id, status FROM scan_tasks").all()).toEqual([
        { id: "scan-1", root_id: "root-1", status: "completed" },
      ]);
      expect(database.sqlite.prepare("SELECT relative_path, size FROM scan_results").all()).toEqual([
        { relative_path: "movie.mp4", size: 20 },
      ]);
      expect(database.sqlite.prepare("SELECT item_id, root_id FROM library_item_files").all()).toEqual([
        { item_id: "item-1", root_id: "root-1" },
      ]);
    } finally {
      database.close();
    }
  });

  it("rolls back a failed migration without changing the baseline", async () => {
    const database = createPersistenceDatabase({ path: ":memory:" });
    try {
      database.sqlite.exec(await readFile(join(defaultMigrationsFolder, "0000_initial.sql"), "utf8"));
      const before = database.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
      const sql = (await readFile(join(defaultMigrationsFolder, migrationFile), "utf8"))
        .replaceAll("--> statement-breakpoint", "")
        .concat("\nSELECT * FROM __mdcz_0001_should_not_exist;\n");
      database.sqlite.exec("BEGIN");
      expect(() => database.sqlite.exec(sql)).toThrow();
      database.sqlite.exec("ROLLBACK");
      expect(
        database.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all(),
      ).toEqual(before);
    } finally {
      database.close();
    }
  });
});

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { defaultMigrationsFolder } from "./migrate";
import { createTestPersistenceDatabase } from "./testDatabase";

const RELEASED_INITIAL_MIGRATION_SHA256 = "5ac9842c4940bfb7571562f68b5ad978000534f89b67bf6525907baf098f40ff";

describe("Persistence migration baseline", () => {
  it("keeps the released initial migration byte-for-byte frozen", async () => {
    const contents = await readFile(join(defaultMigrationsFolder, "0000_initial.sql"));
    expect(createHash("sha256").update(contents).digest("hex")).toBe(RELEASED_INITIAL_MIGRATION_SHA256);
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
        expect.arrayContaining(["scrape_runs", "scrape_run_items", "scrape_item_outcomes", "scrape_run_summaries"]),
      );
      expect(tables).not.toContain("maintenance_previews");
      expect(tables).not.toContain("maintenance_apply_log");

      const runColumns = database.sqlite
        .prepare("PRAGMA table_info(scrape_runs)")
        .all()
        .map((row) => (row as { name: string }).name);
      expect(runColumns).toEqual(["id", "root_id", "output_root_id", "execution_mode", "created_at"]);
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
      expect(outcomeColumns).not.toContain("status");
    } finally {
      database.close();
    }
  });
});

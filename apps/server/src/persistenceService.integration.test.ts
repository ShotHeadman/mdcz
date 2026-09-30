import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { createTempDirectory } from "../../../tests/harness/tempDirectory";
import { runMaintenanceCli } from "./maintenanceCli";
import { ServerPersistenceService } from "./services/persistenceService";

const createService = async () => {
  const directory = await createTempDirectory("server-db");
  const service = new ServerPersistenceService({ databasePath: join(directory.path, "data", "mdcz.sqlite") });

  return {
    databasePath: join(directory.path, "data", "mdcz.sqlite"),
    service,
    cleanup: async () => {
      try {
        await service.close();
      } finally {
        await directory.cleanup();
      }
    },
  };
};

describe("ServerPersistenceService", () => {
  it("creates the database parent directory and runs migrations", async () => {
    const harness = await createService();

    try {
      const state = await harness.service.initialize();
      const tables = state.database.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(harness.service.initialized).toBe(true);
      expect(tables).toEqual(expect.arrayContaining(["__drizzle_migrations", "media_roots", "scan_tasks"]));
      await expect(readFile(harness.databasePath)).resolves.toBeInstanceOf(Buffer);
    } finally {
      await harness.cleanup();
    }

    expect(harness.service.initialized).toBe(false);
    await expect(harness.service.initialize()).rejects.toThrow("Server persistence service is closed");
  });

  it("reuses the initialized state", async () => {
    const harness = await createService();

    try {
      const first = await harness.service.initialize();
      const second = await harness.service.initialize();

      expect(second).toBe(first);
      const competing = new ServerPersistenceService({ databasePath: harness.databasePath });
      await expect(competing.initialize()).rejects.toThrow("Cannot acquire database ownership");
      await competing.close();
      await harness.service.close();
      const restarted = new ServerPersistenceService({ databasePath: harness.databasePath });
      try {
        await expect(restarted.initialize()).resolves.toHaveProperty("database");
      } finally {
        await restarted.close();
      }
    } finally {
      await harness.cleanup();
    }
  });

  it("backs up committed WAL data and permits restoration only after the owner stops", async () => {
    const harness = await createService();
    const backupPath = `${harness.databasePath}.backup`;
    vi.stubEnv("MDCZ_DATABASE_PATH", harness.databasePath);
    try {
      const { database } = await harness.service.initialize();
      database.sqlite
        .prepare("INSERT INTO media_roots (id, display_name, host_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run("backup-root", "Original", "/media", 0, 0);
      await runMaintenanceCli(["database", "backup", backupPath]);
      await runMaintenanceCli(["database", "verify", backupPath]);
      await expect(runMaintenanceCli(["database", "backup", backupPath])).rejects.toMatchObject({ code: "EEXIST" });
      await expect(runMaintenanceCli(["database", "restore", backupPath, "--confirm"])).rejects.toThrow(
        "Cannot acquire database ownership",
      );
      database.sqlite.prepare("UPDATE media_roots SET display_name = 'Changed'").run();
      await harness.service.close();
      await expect(runMaintenanceCli(["database", "restore", backupPath])).rejects.toThrow("Usage:");
      await runMaintenanceCli(["database", "restore", backupPath, "--confirm"]);
      const restored = new ServerPersistenceService({ databasePath: harness.databasePath });
      try {
        const state = await restored.initialize();
        expect(
          state.database.sqlite.prepare("SELECT display_name FROM media_roots WHERE id = 'backup-root'").get(),
        ).toEqual({ display_name: "Original" });
      } finally {
        await restored.close();
      }
    } finally {
      vi.unstubAllEnvs();
      await harness.cleanup();
    }
  });

  it("refuses to start on a database it cannot upgrade until an operator rebuilds it", async () => {
    const harness = await createService();
    try {
      const { database } = await harness.service.initialize();
      database.sqlite
        .prepare("INSERT INTO media_roots (id, display_name, host_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run("old-root", "Old", "/media", 0, 0);
      // A journal behind the actual schema is what databases from an unreleased or reshuffled lineage look like.
      database.sqlite.exec(
        "DELETE FROM __drizzle_migrations WHERE created_at = (SELECT MAX(created_at) FROM __drizzle_migrations)",
      );
      await harness.service.close();

      const blocked = new ServerPersistenceService({ databasePath: harness.databasePath });
      await expect(blocked.initialize()).rejects.toThrow(`database rebuild "${harness.databasePath}" --confirm`);
      await blocked.close();
      await expect(runMaintenanceCli(["database", "rebuild", harness.databasePath])).rejects.toThrow("Usage:");
      await runMaintenanceCli(["database", "rebuild", harness.databasePath, "--confirm"]);

      const rebuilt = new ServerPersistenceService({ databasePath: harness.databasePath });
      try {
        const state = await rebuilt.initialize();
        expect(state.database.sqlite.prepare("SELECT id FROM media_roots").all()).toEqual([]);
      } finally {
        await rebuilt.close();
      }
      const [backupName] = (await readdir(dirname(harness.databasePath))).filter((name) =>
        /^mdcz\.sqlite\.bak-\d+$/u.test(name),
      );
      const backup = new Database(join(dirname(harness.databasePath), backupName ?? ""), { readonly: true });
      try {
        expect(backup.prepare("SELECT id FROM media_roots").all()).toEqual([{ id: "old-root" }]);
      } finally {
        backup.close();
      }
    } finally {
      await harness.cleanup();
    }
  });
});

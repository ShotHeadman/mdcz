import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTempDirectory } from "../../../tests/harness/tempDirectory";

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
    } finally {
      await harness.cleanup();
    }
  });
});

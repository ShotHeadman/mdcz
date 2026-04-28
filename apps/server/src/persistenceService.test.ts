import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ServerPersistenceService } from "./persistenceService";

const createDatabasePath = async (): Promise<string> =>
  join(await mkdtemp(join(tmpdir(), "mdcz-server-db-")), "data", "mdcz.sqlite");

describe("ServerPersistenceService", () => {
  it("creates the database parent directory and runs migrations", async () => {
    const databasePath = await createDatabasePath();
    const service = new ServerPersistenceService({ databasePath });

    const state = await service.initialize();
    const tables = state.database.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(service.initialized).toBe(true);
    expect(tables).toEqual(expect.arrayContaining(["__drizzle_migrations", "media_roots", "task_records"]));
    await expect(readFile(databasePath)).resolves.toBeInstanceOf(Buffer);

    await service.close();
    expect(service.initialized).toBe(false);
  });

  it("reuses the initialized state", async () => {
    const service = new ServerPersistenceService({ databasePath: await createDatabasePath() });

    const first = await service.initialize();
    const second = await service.initialize();

    expect(second).toBe(first);
    await service.close();
  });
});

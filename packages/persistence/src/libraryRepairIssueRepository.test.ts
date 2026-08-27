import { afterEach, describe, expect, it } from "vitest";
import type { PersistenceDatabase } from "./database";
import { LibraryRepairIssueRepository } from "./libraryRepairIssueRepository";
import { createTestPersistenceDatabase } from "./testDatabase";

let database: PersistenceDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("LibraryRepairIssueRepository", () => {
  it("upserts a repair issue and resolves it after a successful repeat", () => {
    database = createTestPersistenceDatabase();
    const repository = new LibraryRepairIssueRepository(database);
    const input = {
      operationId: "run-1",
      operationType: "scrape" as const,
      rootId: "root-1",
      relativePath: "ABC-001/ABC-001.mp4",
      errorMessage: "database commit failed",
    };

    repository.record(input, new Date("2026-08-27T00:00:00.000Z"));
    repository.record({ ...input, errorMessage: "retry failed" }, new Date("2026-08-27T00:01:00.000Z"));

    expect(repository.countUnresolved()).toBe(1);
    expect(repository.listUnresolved()).toMatchObject([{ ...input, errorMessage: "retry failed" }]);

    repository.resolve(input.operationId, input.rootId, input.relativePath, new Date("2026-08-27T00:02:00.000Z"));

    expect(repository.countUnresolved()).toBe(0);
    expect(repository.listUnresolved()).toEqual([]);
  });
});

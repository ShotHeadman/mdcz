import { afterEach, describe, expect, it } from "vitest";
import type { PersistenceDatabase } from "./database";
import { PublicationJournalRepository } from "./publicationJournalRepository";
import { scanTasks } from "./schema";
import { createTestPersistenceDatabase } from "./testDatabase";

let database: PersistenceDatabase | undefined;

const begin = (repository: PublicationJournalRepository, operationId: string, manifest: unknown) =>
  repository.begin({ operationId, operationType: "scrape", manifest, createdAt: new Date("2026-08-28T00:00:00.000Z") });

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("PublicationJournalRepository", () => {
  it("rolls back the transition when the business write throws", () => {
    database = createTestPersistenceDatabase();
    const repository = new PublicationJournalRepository(database);
    begin(repository, "operation-1", { entries: [{ rootId: "root-1", relativePath: "movie.mp4" }] });

    expect(() =>
      repository.commit("operation-1", () => {
        throw new Error("write failed");
      }),
    ).toThrow("write failed");
    expect(repository.listUnfinished()).toEqual([
      expect.objectContaining({ operationId: "operation-1", state: "pending" }),
    ]);
  });

  it("rolls back the business write when the journal transition fails", () => {
    database = createTestPersistenceDatabase();
    const repository = new PublicationJournalRepository(database);

    expect(() =>
      repository.commit("missing", () => {
        database?.db
          .insert(scanTasks)
          .values({
            id: "task-1",
            rootId: "root-1",
            status: "completed",
            createdAt: new Date(),
            updatedAt: new Date(),
            videoCount: 0,
            directoryCount: 0,
          })
          .run();
      }),
    ).toThrow("not pending");
    expect(database.sqlite.prepare("SELECT id FROM scan_tasks").all()).toEqual([]);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import type { PersistenceDatabase } from "./database";
import { LibraryRepository } from "./libraryRepository";
import { ScrapeRunRepository } from "./scrapeRunRepository";
import { createTestPersistenceDatabase } from "./testDatabase";

let database: PersistenceDatabase | undefined;

const createRepository = () => {
  database = createTestPersistenceDatabase();
  return new ScrapeRunRepository(database);
};

const createRun = async (repository: ScrapeRunRepository, id = "run-1") =>
  await repository.create({
    id,
    rootId: "root-1",
    outputRootId: "requested-output",
    executionMode: "batch",
    createdAt: new Date("2026-08-24T00:00:00.000Z"),
    items: [
      { id: `${id}:item-1`, ordinal: 0, rootId: "root-1", relativePath: "ABC-001.mp4" },
      { id: `${id}:item-2`, ordinal: 1, rootId: "root-2", relativePath: "DEF-002.mp4" },
    ],
  });

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("ScrapeRunRepository", () => {
  it("stores one ordered aggregate across the three scrape tables", async () => {
    const repository = createRepository();
    const run = await createRun(repository);

    expect(run).toMatchObject({
      id: "run-1",
      rootId: "root-1",
      requestedOutputRootId: "requested-output",
      disposition: null,
      outcomes: [],
      items: [
        { id: "run-1:item-1", ordinal: 0, relativePath: "ABC-001.mp4" },
        { id: "run-1:item-2", ordinal: 1, relativePath: "DEF-002.mp4" },
      ],
    });
    expect(await repository.list()).toEqual([run]);
    expect(
      database?.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'scrape_%' ORDER BY name")
        .all(),
    ).toEqual([{ name: "scrape_item_outcomes" }, { name: "scrape_run_items" }, { name: "scrape_runs" }]);
  });

  it("appends attempts and derives the latest outcome per item", async () => {
    const repository = createRepository();
    const run = await createRun(repository);
    await repository.commitOutcome({
      id: "first",
      outcome: "failed",
      itemId: run.items[0].id,
      attempt: 1,
      error: "network failed",
    });
    const latest = await repository.commitOutcome({
      id: "second",
      outcome: "failed",
      itemId: run.items[0].id,
      attempt: 2,
      error: "metadata failed",
    });

    const reloaded = await repository.get(run.id);
    expect(reloaded.outcomes).toHaveLength(2);
    expect(repository.latestOutcomes(reloaded)).toEqual([latest]);
    await expect(repository.commitOutcome({ outcome: "skipped", itemId: run.items[0].id, attempt: 2 })).rejects.toThrow(
      "Expected attempt 3",
    );
  });

  it("commits a success and its library entry atomically", async () => {
    const repository = createRepository();
    const run = await createRun(repository);
    const crawlerDataJson = JSON.stringify({ title: "ABC", number: "ABC-001" });
    const committed = await repository.commitOutcome({
      id: "success-1",
      outcome: "success",
      itemId: run.items[0].id,
      attempt: 1,
      crawlerDataJson,
      outputRootId: "actual-output",
      outputRelativePath: "ABC-001/ABC-001.mp4",
      size: 42,
      libraryEntry: {
        id: "library-abc",
        rootId: "actual-output",
        rootRelativePath: "ABC-001/ABC-001.mp4",
        crawlerDataJson,
      },
    });

    expect(committed.outcome).toMatchObject({ id: "success-1", outcome: "success", size: 42 });
    expect(committed.entry).toMatchObject({
      id: "library-abc",
      sourceRunId: run.id,
      sourceOutcomeId: "success-1",
    });
  });

  it("rolls back the outcome when the library transaction fails", async () => {
    const repository = createRepository();
    const library = new LibraryRepository(database as PersistenceDatabase);
    const run = await createRun(repository);
    await library.upsertEntry({ id: "existing", rootId: "output", rootRelativePath: "occupied.mp4" });

    await expect(
      repository.commitOutcome({
        outcome: "success",
        itemId: run.items[0].id,
        attempt: 1,
        crawlerDataJson: "{}",
        outputRootId: "output",
        outputRelativePath: "occupied.mp4",
        size: 1,
        libraryEntry: { id: "conflict", rootId: "output", rootRelativePath: "occupied.mp4" },
      }),
    ).rejects.toThrow("媒体库路径已属于另一个条目");

    expect((await repository.get(run.id)).outcomes).toEqual([]);
    await expect(library.getEntryById("conflict")).rejects.toThrow("Library entry not found");
  });

  it("revises only successful facts while preserving outcome identity", async () => {
    const repository = createRepository();
    const run = await createRun(repository);
    const failed = await repository.commitOutcome({
      outcome: "failed",
      itemId: run.items[0].id,
      attempt: 1,
      error: "failed",
    });
    const success = await repository.commitOutcome({
      outcome: "success",
      itemId: run.items[1].id,
      attempt: 1,
      crawlerDataJson: "{}",
      outputRootId: "output",
      outputRelativePath: "before.mp4",
      size: 1,
      libraryEntry: { id: "library-success", rootId: "output", rootRelativePath: "before.mp4" },
    });

    await expect(
      repository.reviseSuccess({
        outcomeId: failed.id,
        crawlerDataJson: "{}",
        outputRootId: "output",
        outputRelativePath: "failed.mp4",
        uncensoredAmbiguous: false,
        size: 1,
        libraryEntry: { rootId: "output", rootRelativePath: "failed.mp4" },
      }),
    ).rejects.toThrow("Only successful scrape outcomes can be revised");
    const revised = await repository.reviseSuccess({
      outcomeId: success.outcome.id,
      crawlerDataJson: JSON.stringify({ title: "Confirmed" }),
      outputRootId: "output",
      outputRelativePath: "confirmed.mp4",
      uncensoredAmbiguous: false,
      size: 2,
      libraryEntry: { id: "library-success", rootId: "output", rootRelativePath: "confirmed.mp4" },
    });
    expect(revised.outcome).toMatchObject({ id: success.outcome.id, outputRelativePath: "confirmed.mp4", size: 2 });
  });

  it("finalizes once and derives summary facts from latest outcomes", async () => {
    const repository = createRepository();
    const run = await createRun(repository);
    await repository.commitOutcome({
      outcome: "success",
      itemId: run.items[0].id,
      attempt: 1,
      crawlerDataJson: "{}",
      outputRootId: "actual-output",
      outputRelativePath: "ABC-001.mp4",
      size: 50,
      libraryEntry: { rootId: "actual-output", rootRelativePath: "ABC-001.mp4" },
    });
    await expect(repository.finalize({ runId: run.id, disposition: "completed" })).rejects.toThrow(
      "1 item(s) lack an outcome",
    );
    await repository.commitOutcome({
      outcome: "failed",
      itemId: run.items[1].id,
      attempt: 1,
      error: "not found",
    });
    const finalized = await repository.finalize({
      runId: run.id,
      disposition: "completed",
      startedAt: new Date("2026-08-24T04:00:00.000Z"),
      completedAt: new Date("2026-08-24T04:10:00.000Z"),
    });

    expect(repository.summary(finalized)).toEqual({
      runId: run.id,
      disposition: "completed",
      startedAt: new Date("2026-08-24T04:00:00.000Z"),
      completedAt: new Date("2026-08-24T04:10:00.000Z"),
      successCount: 1,
      failedCount: 1,
      skippedCount: 0,
      totalBytes: 50,
      outputRootId: "actual-output",
      error: null,
    });
    await expect(repository.finalize({ runId: run.id, disposition: "completed" })).rejects.toThrow("already finalized");
  });
});

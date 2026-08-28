import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersistenceDatabase } from "./database";
import { LibraryRepository } from "./libraryRepository";
import { mediaRoots } from "./schema";
import { type CommitScrapeOutcomeInput, ScrapeRunRepository } from "./scrapeRunRepository";
import { createTestPersistenceDatabase } from "./testDatabase";

let database: PersistenceDatabase | undefined;

const createRepository = () => {
  database = createTestPersistenceDatabase();
  database.db
    .insert(mediaRoots)
    .values(
      ["root-1", "root-2", "requested-output", "actual-output", "output", "out"].map((id) => ({
        id,
        displayName: id,
        hostPath: `/${id}`,
        rootType: "mounted-filesystem",
        enabled: true,
        deleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    )
    .run();
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

const commitSuccess = (
  repository: ScrapeRunRepository,
  input: Extract<CommitScrapeOutcomeInput, { outcome: "success" }>,
) => {
  if (!database) throw new Error("Test database is not initialized");
  return database.sqlite.transaction(() => repository.commitSuccessOutcome(input))();
};

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
    ).toEqual([
      { name: "scrape_attempts" },
      { name: "scrape_item_outcomes" },
      { name: "scrape_run_items" },
      { name: "scrape_runs" },
    ]);
  });

  it("stores one final outcome for each admitted attempt", async () => {
    const repository = createRepository();
    const run = await createRun(repository);
    const attempt = repository.admitAttempt(run.items[0].id);
    const outcome = await repository.commitOutcome({
      id: "first",
      outcome: "failed",
      attemptId: attempt.id,
      error: "network failed",
    });

    const reloaded = await repository.get(run.id);
    expect(reloaded.attempts).toEqual([attempt]);
    expect(reloaded.outcomes).toEqual([outcome]);
    expect(() => repository.commitOutcome({ outcome: "skipped", attemptId: attempt.id })).toThrow(
      "Scrape attempt already has an outcome",
    );
  });

  it("commits a success and its library entry atomically", async () => {
    const repository = createRepository();
    const run = await createRun(repository);
    const crawlerDataJson = JSON.stringify({ title: "ABC", number: "ABC-001" });
    const committed = commitSuccess(repository, {
      id: "success-1",
      outcome: "success",
      attemptId: repository.admitAttempt(run.items[0].id).id,
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

    const reloaded = await repository.get(run.id);
    expect(reloaded.outcomes).toContainEqual(
      expect.objectContaining({ id: committed.outcomeId, outcome: "success", size: 42 }),
    );
    expect(await new LibraryRepository(database as PersistenceDatabase).getEntryById(committed.entryId)).toMatchObject({
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

    await expect(() =>
      commitSuccess(repository, {
        outcome: "success",
        attemptId: repository.admitAttempt(run.items[0].id).id,
        crawlerDataJson: "{}",
        outputRootId: "output",
        outputRelativePath: "occupied.mp4",
        size: 1,
        libraryEntry: { id: "conflict", rootId: "output", rootRelativePath: "occupied.mp4" },
      }),
    ).toThrow("媒体库路径已属于另一个条目");

    expect((await repository.get(run.id)).outcomes).toEqual([]);
    await expect(library.getEntryById("conflict")).rejects.toThrow("Library entry not found");
  });

  it("revises only successful facts while preserving outcome identity", async () => {
    const repository = createRepository();
    const run = await createRun(repository);
    const failed = await repository.commitOutcome({
      outcome: "failed",
      attemptId: repository.admitAttempt(run.items[0].id).id,
      error: "failed",
    });
    const success = commitSuccess(repository, {
      outcome: "success",
      attemptId: repository.admitAttempt(run.items[1].id).id,
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
      outcomeId: success.outcomeId,
      crawlerDataJson: JSON.stringify({ title: "Confirmed" }),
      outputRootId: "output",
      outputRelativePath: "confirmed.mp4",
      uncensoredAmbiguous: false,
      size: 2,
      libraryEntry: { id: "library-success", rootId: "output", rootRelativePath: "confirmed.mp4" },
    });
    expect(revised.outcome).toMatchObject({ id: success.outcomeId, outputRelativePath: "confirmed.mp4", size: 2 });
  });

  it("finalizes once and derives summary facts from latest outcomes", async () => {
    const repository = createRepository();
    const run = await createRun(repository);
    commitSuccess(repository, {
      outcome: "success",
      attemptId: repository.admitAttempt(run.items[0].id).id,
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
      attemptId: repository.admitAttempt(run.items[1].id).id,
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
      disposition: "failed",
      startedAt: new Date("2026-08-24T04:00:00.000Z"),
      completedAt: new Date("2026-08-24T04:10:00.000Z"),
      successCount: 1,
      failedCount: 1,
      skippedCount: 0,
      totalBytes: 50,
      outputRootId: "actual-output",
      error: null,
    });
    await expect(repository.finalize({ runId: run.id, disposition: "completed" })).resolves.toMatchObject({
      id: run.id,
      disposition: "failed",
    });
  });
  it("appends retry attempts to the same run without re-admitting successes", async () => {
    const repository = createRepository();
    const run = await createRun(repository);
    await repository.commitOutcome({
      outcome: "failed",
      attemptId: repository.admitAttempt(run.items[0].id).id,
      error: "network failed",
    });
    commitSuccess(repository, {
      outcome: "success",
      attemptId: repository.admitAttempt(run.items[1].id).id,
      crawlerDataJson: "{}",
      outputRootId: "out",
      outputRelativePath: "DEF-002.mp4",
      size: 1,
      libraryEntry: { rootId: "out", rootRelativePath: "DEF-002.mp4" },
    });
    await repository.finalize({ runId: run.id, disposition: "completed" });

    const retry = await repository.retry(run.id);

    expect(retry.id).toBe(run.id);
    expect(retry.items).toHaveLength(2);
    expect(retry.attempts).toEqual([
      expect.objectContaining({ itemId: run.items[0].id, attempt: 1 }),
      expect.objectContaining({ itemId: run.items[0].id, attempt: 2 }),
      expect.objectContaining({ itemId: run.items[1].id, attempt: 1 }),
    ]);
    const retryAttempt = retry.attempts.find((attempt) => attempt.itemId === run.items[0].id && attempt.attempt === 2);
    if (!retryAttempt) throw new Error("Retry attempt was not admitted");
    const retryFailure = repository.commitOutcome({
      id: "retry-failure",
      outcome: "failed",
      attemptId: retryAttempt.id,
      error: "still unavailable",
    });
    const finalizedRetry = await repository.finalize({
      runId: run.id,
      disposition: "failed",
      error: "retry failed",
      completedAt: new Date("2026-08-24T05:00:00.000Z"),
    });

    expect(repository.latestOutcomes(finalizedRetry)).toEqual([
      retryFailure,
      expect.objectContaining({ itemId: run.items[1].id, outcome: "success" }),
    ]);
    expect(finalizedRetry).toMatchObject({
      id: run.id,
      disposition: "failed",
      completedAt: new Date("2026-08-24T05:00:00.000Z"),
      error: "retry failed",
    });
    const interrupted = await createRun(repository, "interrupted");
    await repository.finalize({ runId: interrupted.id, disposition: "interrupted" });
    await expect(repository.retry(interrupted.id)).rejects.toThrow("Only completed, failed, or stopped");
  });

  it("requires only interrupted finalization when the latest admitted attempt has no outcome", async () => {
    const repository = createRepository();
    const run = await createRun(repository);
    repository.admitAttempt(run.items[0].id);

    await expect(repository.finalize({ runId: run.id, disposition: "failed" })).rejects.toThrow(
      "2 item(s) lack an outcome",
    );
    await expect(repository.finalize({ runId: run.id, disposition: "interrupted" })).resolves.toMatchObject({
      id: run.id,
      disposition: "interrupted",
    });
  });

  it("interrupts a finalized run when shutdown finds an open retry attempt", async () => {
    const repository = createRepository();
    const run = await createRun(repository);
    await repository.commitOutcome({
      outcome: "failed",
      attemptId: repository.admitAttempt(run.items[0].id).id,
      error: "retry me",
    });
    await repository.commitOutcome({
      outcome: "skipped",
      attemptId: repository.admitAttempt(run.items[1].id).id,
    });
    await repository.finalize({ runId: run.id, disposition: "failed" });
    await repository.retry(run.id);

    repository.interruptUnfinished(new Date("2026-08-24T06:00:00.000Z"));

    await expect(repository.get(run.id)).resolves.toMatchObject({
      disposition: "interrupted",
      completedAt: new Date("2026-08-24T06:00:00.000Z"),
      error: "Interrupted by shutdown",
    });
  });

  it("keeps committed rows when a projection read fails", async () => {
    const repository = createRepository();
    const run = await createRun(repository);
    const committed = commitSuccess(repository, {
      outcome: "success",
      attemptId: repository.admitAttempt(run.items[0].id).id,
      crawlerDataJson: "{}",
      outputRootId: "output",
      outputRelativePath: "ABC-001.mp4",
      size: 1,
      libraryEntry: { rootId: "output", rootRelativePath: "ABC-001.mp4" },
    });
    vi.spyOn(repository, "get").mockRejectedValueOnce(new Error("projection read failed"));

    await expect(repository.get(run.id)).rejects.toThrow("projection read failed");
    expect(database?.sqlite.prepare("SELECT id FROM scrape_item_outcomes").all()).toEqual([
      { id: committed.outcomeId },
    ]);
    expect(database?.sqlite.prepare("SELECT id FROM library_items").all()).toEqual([{ id: committed.entryId }]);
  });
});

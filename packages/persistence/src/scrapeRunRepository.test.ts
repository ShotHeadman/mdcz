import { afterEach, describe, expect, it } from "vitest";
import type { PersistenceDatabase } from "./database";
import { LibraryRepository, type UpsertLibraryEntryInput } from "./libraryRepository";
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
  input: Omit<Extract<CommitScrapeOutcomeInput, { outcome: "success" }>, "libraryEntry"> & {
    libraryEntry: UpsertLibraryEntryInput;
  },
) => {
  if (!database) throw new Error("Test database is not initialized");
  const committed = database.sqlite.transaction(() =>
    repository.commitSuccessOutcomes([input], input.libraryEntry),
  )()[0];
  if (!committed) throw new Error("Scrape success batch did not commit its input");
  return committed;
};

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("ScrapeRunRepository", () => {
  it.each([
    "empty",
    "failed",
    "stopped",
    "interrupted",
    "files",
  ] as const)("persists directory intent independently of its immutable manifest (%s)", async (outcome) => {
    const repository = createRepository();
    const scope = {
      kind: "directory" as const,
      scanDir: "/root-1",
      recursive: true,
      targetDir: "/requested-output",
      extraScanDirs: [],
      excludeDirPaths: [],
    };
    const run = await repository.create({
      rootId: "root-1",
      outputRootId: "requested-output",
      executionMode: "batch",
      directoryScopeJson: JSON.stringify(scope),
      configurationJson: '{"scrape":"captured"}',
      items: [],
    });
    expect(run).toMatchObject({
      directoryScopeJson: JSON.stringify(scope),
      configurationJson: '{"scrape":"captured"}',
      manifestFixedAt: null,
      items: [],
      attempts: [],
    });
    await expect(repository.finalize({ runId: run.id, disposition: "completed" })).rejects.toThrow("Cannot finalize");
    const controller = new AbortController();
    const input = {
      runId: run.id,
      signal: controller.signal,
      items: outcome === "files" ? [{ rootId: "root-1", relativePath: "one.mp4", ordinal: 0 }] : [],
      discoveryJson: JSON.stringify({
        directories: 1,
        candidates: outcome === "files" ? 1 : 0,
        skipped: 0,
        elapsedMs: 1,
        currentPath: null,
        warnings: [],
      }),
    };
    if (outcome === "empty" || outcome === "files") {
      const fixed = await repository.fixManifest(input);
      expect(fixed.manifestFixedAt).toBeInstanceOf(Date);
      expect(fixed.attempts).toEqual([]);
      await expect(repository.fixManifest(input)).rejects.toThrow("Cannot fix");
      if (outcome === "files") {
        repository.commitOutcome({
          attemptId: repository.admitAttempt(fixed.items[0].id).id,
          outcome: "failed",
          error: "failure",
        });
      }
      await repository.finalize({ runId: run.id, disposition: outcome === "files" ? "failed" : "completed" });
    } else {
      controller.abort();
      await expect(repository.fixManifest(input)).rejects.toThrow();
      expect((await repository.get(run.id)).manifestFixedAt).toBeNull();
      if (outcome === "interrupted") repository.interruptUnfinished();
      else await repository.finalize({ runId: run.id, disposition: outcome });
    }
    const stored = await repository.get(run.id);
    expect(stored.disposition).toBe(outcome === "empty" ? "completed" : outcome === "files" ? "failed" : outcome);
    const rerun = await repository.rerunDirectory(run.id);
    expect(rerun.id).not.toBe(run.id);
    expect(rerun).toMatchObject({
      directoryScopeJson: JSON.stringify(scope),
      configurationJson: '{"scrape":"captured"}',
      manifestFixedAt: null,
      items: [],
      attempts: [],
    });
    if (outcome === "files") {
      const retry = await repository.retry(run.id);
      expect(retry.id).toBe(run.id);
      expect(retry.items.map((item) => item.relativePath)).toEqual(["one.mp4"]);
      expect(retry.manifestFixedAt).toEqual(stored.manifestFixedAt);
    }
  });
  it("stores one ordered aggregate across the three scrape tables", async () => {
    const repository = createRepository();
    const run = await createRun(repository);

    expect(run).toMatchObject({
      id: "run-1",
      rootId: "root-1",
      requestedOutputRootId: "requested-output",
      requestedOutputRelativeDirectory: null,
      disposition: null,
      outcomes: [],
      items: [
        { id: "run-1:item-1", ordinal: 0, relativePath: "ABC-001.mp4" },
        { id: "run-1:item-2", ordinal: 1, relativePath: "DEF-002.mp4" },
      ],
    });
    expect(await repository.list()).toEqual([run]);
    expect(await repository.getLatestFinalized()).toBeNull();
  });

  it("hydrates only the latest finalized run", async () => {
    const repository = createRepository();
    const create = async (id: string, createdAt: Date) =>
      await repository.create({
        id,
        rootId: "root-1",
        outputRootId: "requested-output",
        executionMode: "batch",
        createdAt,
        items: [
          { id: `${id}:item-1`, ordinal: 0, rootId: "root-1", relativePath: "ABC-001.mp4" },
          { id: `${id}:item-2`, ordinal: 1, rootId: "root-2", relativePath: "DEF-002.mp4" },
        ],
      });
    const settleFailed = async (run: Awaited<ReturnType<typeof create>>) => {
      await repository.commitOutcome({
        outcome: "failed",
        attemptId: repository.admitAttempt(run.items[0].id).id,
        error: "failed",
      });
      await repository.commitOutcome({
        outcome: "skipped",
        attemptId: repository.admitAttempt(run.items[1].id).id,
      });
      await repository.finalize({ runId: run.id, disposition: "failed" });
    };

    const older = await create("older", new Date("2026-08-24T00:00:00.000Z"));
    await settleFailed(older);
    const unfinished = await create("unfinished", new Date("2026-08-25T00:00:00.000Z"));
    expect(await repository.getLatestFinalized()).toMatchObject({ id: older.id, disposition: "failed" });

    const newer = await create("newer", new Date("2026-08-26T00:00:00.000Z"));
    await settleFailed(newer);
    expect(await repository.getLatestFinalized()).toMatchObject({ id: newer.id, disposition: "failed" });
    expect((await repository.get(unfinished.id)).disposition).toBeNull();
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
      files: [expect.objectContaining({ sourceOutcomeId: "success-1" })],
    });
  });

  it("commits a success batch atomically", async () => {
    const repository = createRepository();
    const run = await repository.create({
      id: "atomic-run",
      rootId: "root-1",
      executionMode: "batch",
      items: [
        { id: "first", ordinal: 0, rootId: "root-1", relativePath: "first.mp4" },
        { id: "second", ordinal: 1, rootId: "root-1", relativePath: "second.mp4" },
      ],
    });
    const library = new LibraryRepository(database as PersistenceDatabase);
    await library.upsertEntry({ id: "occupied", rootId: "output", rootRelativePath: "occupied.mp4" });
    const input = (itemIndex: number, relativePath: string) => ({
      outcome: "success" as const,
      attemptId: repository.admitAttempt(run.items[itemIndex].id).id,
      crawlerDataJson: "{}",
      outputRootId: "output",
      outputRelativePath: relativePath,
      size: 1,
      libraryEntry: { rootId: "output", rootRelativePath: relativePath },
    });
    const first = input(0, "first.mp4");
    const second = input(1, "occupied.mp4");

    expect(() => repository.commitSuccessOutcomes([first, second], { id: "different-owner" })).toThrow(
      "媒体库路径已属于另一个条目",
    );
    expect((await repository.get(run.id)).outcomes).toEqual([]);
    expect((await library.listEntries()).map((entry) => entry.id)).toEqual(["occupied"]);
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

  it("revises successful facts as one atomic batch while preserving outcome identity", async () => {
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
    const revision = {
      outcomeId: success.outcomeId,
      crawlerDataJson: JSON.stringify({ title: "Confirmed" }),
      outputRootId: "output",
      outputRelativePath: "confirmed.mp4",
      uncensoredAmbiguous: false,
      size: 2,
      libraryEntry: { id: "library-success", rootId: "output", rootRelativePath: "confirmed.mp4" },
    };

    expect(() =>
      repository.reviseSuccess([
        revision,
        {
          outcomeId: failed.id,
          crawlerDataJson: "{}",
          outputRootId: "output",
          outputRelativePath: "failed.mp4",
          uncensoredAmbiguous: false,
          size: 1,
          libraryEntry: { rootId: "output", rootRelativePath: "failed.mp4" },
        },
      ]),
    ).toThrow("Only successful scrape outcomes can be revised");
    expect((await repository.get(run.id)).outcomes).toContainEqual(
      expect.objectContaining({ id: success.outcomeId, outputRelativePath: "before.mp4", size: 1 }),
    );

    repository.reviseSuccess([revision]);
    expect((await repository.get(run.id)).outcomes).toContainEqual(
      expect.objectContaining({ id: success.outcomeId, outputRelativePath: "confirmed.mp4", size: 2 }),
    );
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
    expect(finalized.requestedOutputRootId).toBe("requested-output");
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
    const successfulRetry = await repository.retry(run.id, [run.items[1].id]);
    expect(successfulRetry.attempts).toContainEqual(expect.objectContaining({ itemId: run.items[1].id, attempt: 2 }));
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
});

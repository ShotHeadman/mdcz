import { afterEach, describe, expect, it } from "vitest";

import type { PersistenceDatabase } from "./database";
import { LibraryRepository } from "./libraryRepository";
import { ScrapeRunRepository } from "./scrapeRunRepository";
import { createTestPersistenceDatabase } from "./testDatabase";

let database: PersistenceDatabase | undefined;

const createRepository = (): ScrapeRunRepository => {
  database = createTestPersistenceDatabase();
  return new ScrapeRunRepository(database);
};

const createTwoItemRun = async (repository: ScrapeRunRepository, id = "run-1") =>
  await repository.createRun({
    id,
    rootId: "root-1",
    outputRootId: "output-requested",
    executionMode: "batch",
    createdAt: new Date("2026-08-24T00:00:00.000Z"),
    items: [
      { id: `${id}:item-1`, ordinal: 0, rootId: "root-1", relativePath: "ABC-001.mp4" },
      {
        id: `${id}:item-2`,
        ordinal: 1,
        rootId: "root-2",
        relativePath: "DEF-002.mp4",
        manualUrl: "https://example.invalid/DEF-002",
        uncensoredChoice: "umr",
      },
    ],
  });

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("ScrapeRunRepository", () => {
  it("creates immutable ordered manifests and exposes side-effect-free reads", async () => {
    const repository = createRepository();

    const manifest = await createTwoItemRun(repository);

    expect(manifest).toEqual({
      id: "run-1",
      rootId: "root-1",
      outputRootId: "output-requested",
      executionMode: "batch",
      createdAt: new Date("2026-08-24T00:00:00.000Z"),
      items: [
        {
          id: "run-1:item-1",
          runId: "run-1",
          ordinal: 0,
          rootId: "root-1",
          relativePath: "ABC-001.mp4",
          manualUrl: null,
          uncensoredChoice: null,
        },
        {
          id: "run-1:item-2",
          runId: "run-1",
          ordinal: 1,
          rootId: "root-2",
          relativePath: "DEF-002.mp4",
          manualUrl: "https://example.invalid/DEF-002",
          uncensoredChoice: "umr",
        },
      ],
    });
    expect(await repository.getRun("run-1")).toEqual(manifest);
    expect(await repository.listRuns()).toEqual([manifest]);
    expect(await repository.getSummary("run-1")).toBeNull();
    expect(await repository.latestSummary()).toBeNull();
  });

  it("rejects empty and duplicate manifests without leaving partial rows", async () => {
    const repository = createRepository();
    const base = {
      rootId: "root-1",
      executionMode: "batch" as const,
    };

    await expect(repository.createRun({ ...base, id: "empty", items: [] })).rejects.toThrow(
      "must contain at least one item",
    );
    await expect(
      repository.createRun({
        ...base,
        id: "duplicate-ordinal",
        items: [
          { id: "ordinal-a", ordinal: 0, rootId: "root-1", relativePath: "A.mp4" },
          { id: "ordinal-b", ordinal: 0, rootId: "root-1", relativePath: "B.mp4" },
        ],
      }),
    ).rejects.toThrow("Duplicate scrape item ordinal");
    await expect(
      repository.createRun({
        ...base,
        id: "duplicate-path",
        items: [
          { id: "path-a", ordinal: 0, rootId: "root-1", relativePath: "A.mp4" },
          { id: "path-b", ordinal: 1, rootId: "root-1", relativePath: "A.mp4" },
        ],
      }),
    ).rejects.toThrow("Duplicate scrape item path");
    await expect(repository.listRuns()).resolves.toEqual([]);
  });

  it("rolls back an entire manifest when a database constraint fails", async () => {
    const repository = createRepository();
    await createTwoItemRun(repository, "existing");

    await expect(
      repository.createRun({
        id: "new-run",
        rootId: "root-1",
        executionMode: "single",
        items: [{ id: "existing:item-1", ordinal: 0, rootId: "root-1", relativePath: "NEW.mp4" }],
      }),
    ).rejects.toThrow();

    expect((await repository.listRuns()).map((run) => run.id)).toEqual(["existing"]);
  });

  it("enforces terminal-only status checks in SQLite", async () => {
    const repository = createRepository();
    await createTwoItemRun(repository);

    expect(() =>
      database?.sqlite
        .prepare("INSERT INTO scrape_runs (id, root_id, execution_mode, created_at) VALUES (?, ?, ?, ?)")
        .run("live-run", "root-1", "running", 1),
    ).toThrow(/CHECK constraint failed/u);
    expect(() =>
      database?.sqlite
        .prepare(
          "INSERT INTO scrape_item_outcomes (id, run_id, item_id, attempt, outcome, completed_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("live-outcome", "run-1", "run-1:item-1", 1, "processing", 1),
    ).toThrow(/CHECK constraint failed/u);
    expect(() =>
      database?.sqlite
        .prepare(
          "INSERT INTO scrape_run_summaries (run_id, disposition, completed_at, success_count, failed_count, skipped_count, total_bytes) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run("run-1", "paused", 1, 0, 0, 0, 0),
    ).toThrow(/CHECK constraint failed/u);
  });

  it("appends retry attempts and keeps the previous terminal outcome", async () => {
    const repository = createRepository();
    await createTwoItemRun(repository);
    const firstCompletedAt = new Date("2026-08-24T01:00:00.000Z");
    const secondCompletedAt = new Date("2026-08-24T01:01:00.000Z");

    const first = await repository.commitFailure({
      id: "outcome-1",
      runId: "run-1",
      itemId: "run-1:item-1",
      attempt: 1,
      error: "network failed",
      completedAt: firstCompletedAt,
    });
    const second = await repository.commitFailure({
      id: "outcome-2",
      runId: "run-1",
      itemId: "run-1:item-1",
      attempt: 2,
      error: "metadata failed",
      completedAt: secondCompletedAt,
    });

    expect(await repository.listOutcomes("run-1")).toEqual([first, second]);
    expect(await repository.listLatestOutcomes("run-1")).toEqual([second]);
    await expect(
      repository.commitSkipped({
        runId: "run-1",
        itemId: "run-1:item-1",
        attempt: 2,
      }),
    ).rejects.toThrow("Expected attempt 3");
  });

  it("commits a success and its library facts in one transaction", async () => {
    const repository = createRepository();
    await createTwoItemRun(repository);
    const crawlerDataJson = JSON.stringify({ title: "ABC", number: "ABC-001" });

    const committed = await repository.commitSuccess({
      id: "success-1",
      runId: "run-1",
      itemId: "run-1:item-1",
      attempt: 1,
      crawlerDataJson,
      nfoRootId: "metadata-root",
      nfoRelativePath: "ABC-001/ABC-001.nfo",
      outputRootId: "actual-output",
      outputRelativePath: "ABC-001/ABC-001.mp4",
      size: 42,
      modifiedAt: new Date("2026-08-24T02:00:00.000Z"),
      completedAt: new Date("2026-08-24T02:01:00.000Z"),
      libraryEntry: {
        id: "library-abc",
        rootId: "actual-output",
        rootRelativePath: "ABC-001/ABC-001.mp4",
        title: "ABC",
        number: "ABC-001",
        crawlerDataJson,
        size: 42,
      },
    });

    expect(committed.outcome).toMatchObject({
      id: "success-1",
      runId: "run-1",
      itemId: "run-1:item-1",
      attempt: 1,
      outcome: "success",
      size: 42,
    });
    expect(committed.entry).toMatchObject({
      id: "library-abc",
      sourceTaskId: "run-1",
      scrapeOutputId: "success-1",
      rootRelativePath: "ABC-001/ABC-001.mp4",
    });
  });

  it("rolls back both outcome and library writes when the library constraint fails", async () => {
    const repository = createRepository();
    const library = new LibraryRepository(database as PersistenceDatabase);
    await createTwoItemRun(repository);
    await library.upsertEntry({
      id: "existing-entry",
      rootId: "actual-output",
      rootRelativePath: "occupied.mp4",
    });

    await expect(
      repository.commitSuccess({
        id: "rolled-back-outcome",
        runId: "run-1",
        itemId: "run-1:item-1",
        attempt: 1,
        crawlerDataJson: "{}",
        outputRootId: "actual-output",
        outputRelativePath: "occupied.mp4",
        size: 1,
        libraryEntry: {
          id: "different-entry",
          rootId: "actual-output",
          rootRelativePath: "occupied.mp4",
        },
      }),
    ).rejects.toThrow("媒体库路径已属于另一个条目");

    await expect(repository.listOutcomes("run-1")).resolves.toEqual([]);
    await expect(library.getEntryById("different-entry")).rejects.toThrow("Library entry not found");
    await expect(library.getEntryById("existing-entry")).resolves.toMatchObject({ id: "existing-entry" });
  });

  it("revises only success facts while preserving outcome identity", async () => {
    const repository = createRepository();
    await createTwoItemRun(repository);
    await repository.commitFailure({
      id: "failed-outcome",
      runId: "run-1",
      itemId: "run-1:item-1",
      attempt: 1,
      error: "failed",
    });
    await repository.commitSuccess({
      id: "success-outcome",
      runId: "run-1",
      itemId: "run-1:item-2",
      attempt: 1,
      crawlerDataJson: "{}",
      outputRootId: "actual-output",
      outputRelativePath: "before.mp4",
      size: 1,
      libraryEntry: {
        id: "library-success",
        rootId: "actual-output",
        rootRelativePath: "before.mp4",
      },
    });

    await expect(
      repository.reviseSuccess({
        outcomeId: "failed-outcome",
        crawlerDataJson: "{}",
        outputRootId: "actual-output",
        outputRelativePath: "failed.mp4",
        uncensoredAmbiguous: false,
        size: 1,
        libraryEntry: { rootId: "actual-output", rootRelativePath: "failed.mp4" },
      }),
    ).rejects.toThrow("Only successful scrape outcomes can be revised");

    const revised = await repository.reviseSuccess({
      outcomeId: "success-outcome",
      crawlerDataJson: JSON.stringify({ title: "Confirmed" }),
      nfoRootId: "metadata-root",
      nfoRelativePath: "confirmed.nfo",
      outputRootId: "actual-output",
      outputRelativePath: "confirmed.mp4",
      uncensoredAmbiguous: false,
      size: 2,
      modifiedAt: new Date("2026-08-24T03:00:00.000Z"),
      libraryEntry: {
        id: "library-success",
        rootId: "actual-output",
        rootRelativePath: "confirmed.mp4",
        title: "Confirmed",
        size: 2,
      },
    });

    expect(revised.outcome).toMatchObject({
      id: "success-outcome",
      runId: "run-1",
      itemId: "run-1:item-2",
      attempt: 1,
      outcome: "success",
      outputRelativePath: "confirmed.mp4",
      size: 2,
    });
    expect(revised.entry).toMatchObject({
      id: "library-success",
      sourceTaskId: "run-1",
      scrapeOutputId: "success-outcome",
      rootRelativePath: "confirmed.mp4",
    });
  });

  it("derives one-shot summaries from every item's latest attempt", async () => {
    const repository = createRepository();
    await createTwoItemRun(repository);
    await repository.commitFailure({
      id: "item-1-attempt-1",
      runId: "run-1",
      itemId: "run-1:item-1",
      attempt: 1,
      error: "first attempt failed",
    });
    await repository.commitSuccess({
      id: "item-1-attempt-2",
      runId: "run-1",
      itemId: "run-1:item-1",
      attempt: 2,
      crawlerDataJson: "{}",
      outputRootId: "actual-output",
      outputRelativePath: "ABC-001.mp4",
      size: 50,
      libraryEntry: { rootId: "actual-output", rootRelativePath: "ABC-001.mp4" },
    });

    await expect(repository.finalizeRun({ runId: "run-1", disposition: "completed" })).rejects.toThrow(
      "1 item(s) lack an outcome",
    );

    await repository.commitFailure({
      id: "item-2-attempt-1",
      runId: "run-1",
      itemId: "run-1:item-2",
      attempt: 1,
      error: "not found",
    });
    const summary = await repository.finalizeRun({
      runId: "run-1",
      disposition: "completed",
      outputRootId: "actual-output",
      outputDirectory: "/output",
      startedAt: new Date("2026-08-24T04:00:00.000Z"),
      completedAt: new Date("2026-08-24T04:10:00.000Z"),
    });

    expect(summary).toEqual({
      runId: "run-1",
      disposition: "completed",
      startedAt: new Date("2026-08-24T04:00:00.000Z"),
      completedAt: new Date("2026-08-24T04:10:00.000Z"),
      successCount: 1,
      failedCount: 1,
      skippedCount: 0,
      totalBytes: 50,
      outputRootId: "actual-output",
      outputDirectory: "/output",
      error: null,
    });
    await expect(repository.latestSummary()).resolves.toEqual(summary);
    await expect(repository.finalizeRun({ runId: "run-1", disposition: "completed" })).rejects.toThrow();
    await expect(repository.commitSkipped({ runId: "run-1", itemId: "run-1:item-2", attempt: 2 })).rejects.toThrow(
      "already finalized",
    );
  });

  it("validates completed, failed, and stopped disposition semantics", async () => {
    const repository = createRepository();
    const failedRun = await repository.createRun({
      id: "failed-run",
      rootId: "root-1",
      executionMode: "single",
      items: [{ id: "failed-item", ordinal: 0, rootId: "root-1", relativePath: "failed.mp4" }],
    });
    await repository.commitFailure({
      runId: failedRun.id,
      itemId: "failed-item",
      attempt: 1,
      error: "failed",
    });
    await expect(repository.finalizeRun({ runId: failedRun.id, disposition: "completed" })).rejects.toThrow(
      "must contain at least one successful item",
    );
    await expect(repository.finalizeRun({ runId: failedRun.id, disposition: "failed" })).resolves.toMatchObject({
      failedCount: 1,
      disposition: "failed",
    });

    const stoppedRun = await repository.createRun({
      id: "stopped-run",
      rootId: "root-1",
      executionMode: "single",
      items: [{ id: "stopped-item", ordinal: 0, rootId: "root-1", relativePath: "stopped.mp4" }],
    });
    await repository.commitSkipped({
      runId: stoppedRun.id,
      itemId: "stopped-item",
      attempt: 1,
      error: "刮削已停止",
    });
    await expect(repository.finalizeRun({ runId: stoppedRun.id, disposition: "stopped" })).resolves.toMatchObject({
      skippedCount: 1,
      disposition: "stopped",
    });
  });
});

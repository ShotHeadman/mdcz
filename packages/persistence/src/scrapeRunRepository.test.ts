import { afterEach, describe, expect, it } from "vitest";
import type { PersistenceDatabase } from "./database";
import { LibraryRepository, type UpsertLibraryEntryInput } from "./libraryRepository";
import { mediaRoots } from "./schema";
import { ScrapeRunRepository } from "./scrapeRunRepository";
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
  input: {
    itemId: string;
    libraryEntry: UpsertLibraryEntryInput;
    error?: string | null;
    uncensoredAmbiguous?: boolean;
    completedAt?: Date;
  },
) => {
  if (!database) throw new Error("Test database is not initialized");
  const committed = database.sqlite.transaction(() =>
    repository.commitSuccessOutcomes(
      [{ ...input, libraryEntry: input.libraryEntry.files[0] }],
      input.libraryEntry.movie,
    ),
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
    ["empty", "no failed or skipped items"],
    ["failed", "目录文件列表尚未生成，无法重试，请重新扫描目录"],
    ["stopped", "目录文件列表尚未生成，无法重试，请重新扫描目录"],
    ["interrupted", "Only completed, failed, or stopped"],
    ["files", null],
  ] as const)("persists directory intent independently of its immutable manifest (%s)", async (outcome, retryError) => {
    const repository = createRepository();
    const scope = {
      kind: "directory" as const,
      scanDir: "/root-1",
      recursive: true,
      targetDir: "/requested-output",
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
      await expect(repository.fixManifest(input)).rejects.toThrow("Cannot fix");
      if (outcome === "files") {
        repository.commitOutcome({
          itemId: fixed.items[0].id,
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
    if (retryError) {
      await expect(repository.retry(run.id)).rejects.toThrow(retryError);
      await expect(repository.retry(run.id, ["unknown-item"])).rejects.toThrow(
        outcome === "empty" ? "does not belong to run" : retryError,
      );
      expect(await repository.get(run.id)).toEqual(stored);
    }
    const rerun = await repository.rerunDirectory(run.id);
    expect(rerun.id).not.toBe(run.id);
    expect(rerun).toMatchObject({
      previousRunId: run.id,
      directoryScopeJson: JSON.stringify(scope),
      configurationJson: '{"scrape":"captured"}',
      manifestFixedAt: null,
      items: [],
    });
    if (outcome === "files") {
      const retry = await repository.retry(run.id);
      expect(retry.id).not.toBe(run.id);
      expect(retry.previousRunId).toBe(run.id);
      expect(retry.configurationJson).toBe('{"scrape":"captured"}');
      expect(retry.items.map((item) => item.relativePath)).toEqual(["one.mp4"]);
    }
  });

  it("stores one ordered aggregate of scrape run and run items", async () => {
    const repository = createRepository();
    const run = await createRun(repository);

    expect(run).toMatchObject({
      id: "run-1",
      rootId: "root-1",
      requestedOutputRootId: "requested-output",
      requestedOutputRelativeDirectory: null,
      disposition: null,
      items: [
        { id: "run-1:item-1", ordinal: 0, relativePath: "ABC-001.mp4", status: null },
        { id: "run-1:item-2", ordinal: 1, relativePath: "DEF-002.mp4", status: null },
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
      repository.commitOutcome({
        outcome: "failed",
        itemId: run.items[0].id,
        error: "failed",
      });
      repository.commitOutcome({
        outcome: "skipped",
        itemId: run.items[1].id,
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

  it("commits a success and its library entry atomically", async () => {
    const repository = createRepository();
    const run = await createRun(repository);
    const crawlerDataJson = JSON.stringify({ title: "ABC", number: "ABC-001" });
    const committed = commitSuccess(repository, {
      itemId: run.items[0].id,
      libraryEntry: {
        movie: { id: "library-abc", crawlerDataJson },
        files: [{ rootId: "actual-output", rootRelativePath: "ABC-001/ABC-001.mp4", fileId: "library-abc" + ":file" }],
      },
    });

    const reloaded = await repository.get(run.id);
    expect(reloaded.items[0]).toMatchObject({
      id: run.items[0].id,
      status: "success",
      libraryFileId: "library-abc:file",
    });
    expect(await new LibraryRepository(database as PersistenceDatabase).getEntryById(committed.entryId)).toMatchObject({
      id: "library-abc",
      files: [expect.objectContaining({ id: "library-abc:file", sourceItemId: run.items[0].id })],
    });
  });

  it("finalizes once and derives summary facts", async () => {
    const repository = createRepository();
    const run = await createRun(repository);
    commitSuccess(repository, {
      itemId: run.items[0].id,
      libraryEntry: {
        movie: { id: "fixture-movie" },
        files: [{ rootId: "actual-output", rootRelativePath: "ABC-001.mp4", fileId: "fixture-movie:file" }],
      },
    });
    await expect(repository.finalize({ runId: run.id, disposition: "completed" })).rejects.toThrow(
      "1 item(s) lack an outcome",
    );
    repository.commitOutcome({
      outcome: "failed",
      itemId: run.items[1].id,
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
      totalBytes: 0,
      outputRootId: "requested-output",
      error: null,
    });
  });

  it("retries as a new run referencing previousRunId without re-admitting successes", async () => {
    const repository = createRepository();
    const run = await createRun(repository);
    repository.commitOutcome({
      outcome: "failed",
      itemId: run.items[0].id,
      error: "network failed",
    });
    commitSuccess(repository, {
      itemId: run.items[1].id,
      libraryEntry: {
        movie: { id: "fixture-movie" },
        files: [{ rootId: "out", rootRelativePath: "DEF-002.mp4", fileId: "fixture-movie:file" }],
      },
    });
    await repository.finalize({ runId: run.id, disposition: "completed" });

    const retry = await repository.retry(run.id);

    expect(retry.id).not.toBe(run.id);
    expect(retry.previousRunId).toBe(run.id);
    expect(retry.items).toHaveLength(1);
    expect(retry.items[0].relativePath).toBe("ABC-001.mp4");
    expect(retry.items[0].status).toBeNull();
  });

  it("interrupts unfinished runs and unsettled items on shutdown", async () => {
    const repository = createRepository();
    const run = await createRun(repository);
    repository.commitOutcome({
      outcome: "failed",
      itemId: run.items[0].id,
      error: "retry me",
    });

    repository.interruptUnfinished(new Date("2026-08-24T06:00:00.000Z"));

    const reloaded = await repository.get(run.id);
    expect(reloaded).toMatchObject({
      disposition: "interrupted",
      completedAt: new Date("2026-08-24T06:00:00.000Z"),
      error: "Interrupted by shutdown",
    });
    expect(reloaded.items[1]).toMatchObject({
      status: "failed",
      errorMessage: "任务已中断",
    });
  });
});

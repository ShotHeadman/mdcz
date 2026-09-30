import { afterEach, describe, expect, it } from "vitest";
import type { PersistenceDatabase } from "./database";
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
      await repository.finalize({
        runId: run.id,
        disposition: outcome === "files" ? "failed" : "completed",
        failedCount: outcome === "files" ? 1 : 0,
        successCount: outcome === "files" ? 0 : 1,
      });
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
      previousRunId: run.id,
      directoryScopeJson: JSON.stringify(scope),
      configurationJson: '{"scrape":"captured"}',
      manifestFixedAt: null,
      items: [],
    });
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
      totalItems: 2,
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
      await repository.finalize({
        runId: run.id,
        disposition: "failed",
        failedCount: 1,
        skippedCount: 1,
      });
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

  it("finalizes once and derives summary facts", async () => {
    const repository = createRepository();
    const run = await createRun(repository);

    const finalized = await repository.finalize({
      runId: run.id,
      disposition: "completed",
      startedAt: new Date("2026-08-24T04:00:00.000Z"),
      completedAt: new Date("2026-08-24T04:10:00.000Z"),
      successCount: 1,
      failedCount: 1,
      skippedCount: 0,
      totalBytes: 2048,
    });

    expect(repository.summary(finalized)).toEqual({
      runId: run.id,
      disposition: "failed",
      startedAt: new Date("2026-08-24T04:00:00.000Z"),
      completedAt: new Date("2026-08-24T04:10:00.000Z"),
      successCount: 1,
      failedCount: 1,
      skippedCount: 0,
      totalBytes: 2048,
      outputRootId: "requested-output",
      error: null,
    });
  });

  it("interrupts unfinished runs on shutdown", async () => {
    const repository = createRepository();
    const run = await createRun(repository);

    repository.interruptUnfinished(new Date("2026-08-24T06:00:00.000Z"));

    const reloaded = await repository.get(run.id);
    expect(reloaded).toMatchObject({
      disposition: "interrupted",
      completedAt: new Date("2026-08-24T06:00:00.000Z"),
      error: "Interrupted by shutdown",
    });
  });
});

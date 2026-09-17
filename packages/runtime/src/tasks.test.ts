import { defaultConfiguration } from "@mdcz/shared/config";
import type { ScrapeResult } from "@mdcz/shared/types";
import { describe, expect, it } from "vitest";
import { getScrapeItemExecutionContext, runWithScrapeItem } from "./network";
import { activateNetworkFixtureContext } from "./network/networkFixtureContext";
import { applyScrapeNetworkPolicy, buildScrapePublicationKey, createScrapeExecutionPolicy } from "./scrape";
import { ScrapeTargetConflictError } from "./scrape/preflightScrapeTask";
import { MAX_LIVE_SCRAPE_LOGS, ScrapeRunSession, TaskExecutor } from "./tasks";

describe("task executor", () => {
  it("pauses queue admission while allowing in-flight items to settle", async () => {
    let releaseFirst!: () => void;
    let signalStarted!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const started: number[] = [];
    const applied: number[] = [];
    const executor = new TaskExecutor<number, number>({
      concurrency: 1,
      runItem: async (item) => {
        started.push(item);
        signalStarted();
        if (item === 1) await firstBlocked;
        return item;
      },
      applyResult: async (_item, result) => {
        applied.push(result);
      },
    });

    const run = executor.execute([1, 2, 3]);
    await firstStarted;
    executor.pause();
    releaseFirst();
    await expect(run).resolves.toBeUndefined();
    expect(started).toEqual([1]);
    expect(applied).toEqual([1]);
  });

  it("aborts in-flight work and never starts pending items after stop", async () => {
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const invoked: number[] = [];
    const executor = new TaskExecutor<number, number>({
      concurrency: 1,
      runItem: async (item, context) => {
        invoked.push(item);
        signalStarted();
        await new Promise<void>((resolve) => context.signal.addEventListener("abort", () => resolve(), { once: true }));
        return item;
      },
      applyResult: async () => undefined,
    });

    const run = executor.execute([1, 2]);
    await started;
    executor.stop();
    await expect(run).resolves.toBeUndefined();
    expect(invoked).toEqual([1]);
  });
  it("waits for sibling workers before rejecting a concurrent execution", async () => {
    const siblingStarted = deferred<void>();
    const releaseSibling = deferred<void>();
    let settled = false;
    const executor = new TaskExecutor<number, number>({
      concurrency: 2,
      runItem: async (item) => {
        if (item === 1) throw new Error("worker failed");
        siblingStarted.resolve();
        await releaseSibling.promise;
        return item;
      },
      applyResult: async () => undefined,
    });

    const run = executor.execute([1, 2]).finally(() => {
      settled = true;
    });
    await siblingStarted.promise;
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseSibling.resolve();
    await expect(run).rejects.toThrow("worker failed");
  });

  it("serializes publication and stops admission after the first concurrent failure", async () => {
    const concurrency = 2;
    const started: number[] = [];
    const applied: number[] = [];
    const finalized: number[] = [];
    const executor = new TaskExecutor<number, number>({
      concurrency,
      runItem: async (item) => {
        started.push(item);
        return item;
      },
      applyResult: async (_item, result) => {
        applied.push(result);
        if (result === 1) throw new Error("publication conflict");
      },
      finalizeResult: async (_item, result) => {
        finalized.push(result);
        if (result === 1) throw new Error("cleanup failed");
      },
    });

    await expect(executor.execute([1, 2, 3, 4, 5, 6])).rejects.toThrow("publication conflict");
    expect(applied).toEqual([1]);
    expect(started.length).toBeLessThanOrEqual(concurrency);
    expect(finalized.sort()).toEqual([...started].sort());
  });
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const runItem = (id: string) => ({
  id,
  rootId: "root-1",
  relativePath: `${id}.mp4`,
  sourcePath: `/media/${id}.mp4`,
});

const admitItem = async (item: { id: string }): Promise<string> => `${item.id}:attempt`;

const prepareItem = async () => ({ status: "prepared" as const, prepared: undefined });
const validatePrepared = async () => undefined;
const commitPreparationItem = async (_item: ReturnType<typeof runItem>, result: ScrapeResult) => result;
const acquireItems = () => () => undefined;
const executeAsGroup =
  (
    execute: (
      item: ReturnType<typeof runItem>,
      prepared: undefined,
      signal: AbortSignal,
      attemptId: string,
    ) => Promise<ScrapeResult & { release?: () => Promise<void> }>,
  ) =>
  async (
    entries: readonly {
      item: ReturnType<typeof runItem>;
      prepared: undefined;
      attemptId: string;
    }[],
    signal: AbortSignal,
  ) => {
    const entriesWithResults = await Promise.all(
      entries.map(async ({ item, prepared, attemptId }) => ({
        itemId: item.id,
        result: await runWithScrapeItem(
          {
            itemId: item.id,
            relativePath: item.relativePath,
            caseId: "caseId" in item && typeof item.caseId === "string" ? item.caseId : undefined,
          },
          async () => await execute(item, prepared, signal, attemptId),
        ),
      })),
    );
    return {
      results: entriesWithResults.map(({ itemId, result: { release: _release, ...result } }) => ({ itemId, result })),
      release: async () => {
        const settled = await Promise.allSettled(
          entriesWithResults.map(async ({ result }) => await result.release?.()),
        );
        const errors = settled.flatMap((entry) => (entry.status === "rejected" ? [entry.reason] : []));
        if (errors.length) throw new AggregateError(errors, "Staging cleanup failed");
      },
    };
  };
const commitAsGroup =
  (commit: (item: ReturnType<typeof runItem>, result: ScrapeResult, attemptId: string) => Promise<ScrapeResult>) =>
  async (
    entries: readonly {
      item: ReturnType<typeof runItem>;
      result?: ScrapeResult;
      attemptId: string;
    }[],
  ) =>
    await Promise.all(
      entries.map(async ({ item, result, attemptId }) => ({
        itemId: item.id,
        result: await commit(item, result as ScrapeResult, attemptId),
      })),
    );

const terminalResult = (
  item: { id: string; rootId: string; relativePath: string; sourcePath: string },
  status: "success" | "failed" | "skipped",
): ScrapeResult => ({
  fileId: item.id,
  rootId: item.rootId,
  relativePath: item.relativePath,
  fileName: `${item.id}.mp4`,
  status,
  assets: [],
  ...(status === "failed" ? { error: "failed" } : {}),
});

describe("scrape run session", () => {
  const formExecutionGroups = (entries: readonly { item: { id: string } }[]) =>
    entries.map(({ item }) => ({ itemIds: [item.id], publicationKeys: [] }));
  it("holds shared output ownership through commit while independent directories execute", async () => {
    const committing = deferred<void>();
    const releaseCommit = deferred<void>();
    const independent = deferred<void>();
    const executed: string[] = [];
    const session = new ScrapeRunSession({
      runId: "publication-ownership",
      totalItems: 3,
      prepare: async () => ({
        items: [runItem("ABC-001"), runItem("XYZ-002"), runItem("independent")],
        concurrency: 3,
        admitItem,
        prepareItem,
        validatePrepared,
        commitPreparationItem,
        acquireItems,
        formExecutionGroups: (entries) =>
          entries.map(({ item }) => ({
            itemIds: [item.id],
            publicationKeys: [
              buildScrapePublicationKey({
                outputDir: item.id === "independent" ? "/output/independent" : "/output/shared",
                metadataDir: item.id === "independent" ? "/output/independent" : "/output/shared",
                targetVideoPath: `/output/${item.id}.mp4`,
                nfoPath: `/output/${item.id}.nfo`,
              }),
            ],
          })),
        executePreparedItems: executeAsGroup(async (item) => {
          executed.push(item.id);
          if (item.id === "independent") independent.resolve();
          return terminalResult(item, "success");
        }),
        commitItems: commitAsGroup(async (item, result) => {
          if (item.id === "ABC-001") {
            committing.resolve();
            await releaseCommit.promise;
          }
          return result;
        }),
      }),
      onSnapshot: () => undefined,
    });
    await session.start();
    await Promise.all([committing.promise, independent.promise]);
    expect(executed).toEqual(["ABC-001", "independent"]);
    releaseCommit.resolve();
    await session.waitForIdle();
    expect(executed).toEqual(["ABC-001", "independent", "XYZ-002"]);
    expect(session.snapshot().status).toBe("completed");
  });

  it("executes and commits candidate movie files as one group", async () => {
    const items = [runItem("part-1"), runItem("part-2"), runItem("other")];
    const executed: string[] = [];
    const committed: string[][] = [];
    const session = new ScrapeRunSession({
      runId: "movie-groups",
      totalItems: items.length,
      prepare: async () => ({
        items,
        concurrency: 2,
        admitItem,
        prepareItem,
        validatePrepared,
        commitPreparationItem,
        acquireItems,
        formExecutionGroups: () => [
          { itemIds: ["part-1", "part-2"], publicationKeys: [] },
          { itemIds: ["other"], publicationKeys: [] },
        ],
        executePreparedItems: executeAsGroup(async (item) => {
          executed.push(item.id);
          return terminalResult(item, "success");
        }),
        commitItems: async (entries) => {
          committed.push(entries.map(({ item }) => item.id));
          return entries.map(({ item, result }) => ({ itemId: item.id, result: result as ScrapeResult }));
        },
      }),
      onSnapshot: () => undefined,
    });

    await session.start();
    await session.waitForIdle();

    expect(executed.sort()).toEqual(["other", "part-1", "part-2"]);
    expect(committed).toEqual(expect.arrayContaining([["part-1", "part-2"], ["other"]]));
    expect(session.snapshot().status).toBe("completed");
  });

  it("finishes an in-flight preflight while paused and resumes execution without repeating it", async () => {
    const checking = deferred<void>();
    const checked = deferred<void>();
    let checks = 0;
    const executed: string[] = [];
    const session = new ScrapeRunSession({
      runId: "paused-preflight",
      totalItems: 1,
      prepare: async () => ({
        items: [runItem("one")],
        concurrency: 1,
        admitItem,
        prepareItem,
        commitPreparationItem,
        acquireItems,
        formExecutionGroups,
        validatePrepared: async () => {
          checks += 1;
          checking.resolve();
          await checked.promise;
        },
        executePreparedItems: executeAsGroup(async (item) => {
          executed.push(item.id);
          return terminalResult(item, "success");
        }),
        commitItems: commitAsGroup(async (_item, result) => result),
      }),
      onSnapshot: () => undefined,
    });
    await session.start();
    await checking.promise;
    await session.pause();
    checked.resolve();
    await session.waitForIdle();
    expect(executed).toEqual([]);
    await session.resume();
    expect(session.snapshot().status).toBe("queued");
    await session.start();
    await session.waitForIdle();
    expect(checks).toBe(1);
    expect(executed).toEqual(["one"]);
    expect(session.snapshot().status).toBe("completed");
  });

  it("commits only identified preflight conflicts and continues unrelated items", async () => {
    const items = [runItem("conflict"), runItem("one"), runItem("two")];
    const executed: string[] = [];
    const preparationCommits: string[] = [];
    let checks = 0;
    const session = new ScrapeRunSession({
      runId: "isolated-preflight-conflict",
      totalItems: items.length,
      prepare: async () => ({
        items,
        concurrency: 2,
        admitItem,
        prepareItem,
        formExecutionGroups,
        validatePrepared: async () => {
          checks += 1;
          if (checks === 1) {
            throw new ScrapeTargetConflictError([
              { itemId: "conflict", sourcePath: "/source.mp4", targetPath: "/target.mp4", message: "目标路径冲突" },
            ]);
          }
        },
        commitPreparationItem: async (item, result) => {
          preparationCommits.push(item.id);
          return result;
        },
        acquireItems,
        executePreparedItems: executeAsGroup(async (item) => {
          executed.push(item.id);
          return terminalResult(item, "success");
        }),
        commitItems: commitAsGroup(async (_item, result) => result),
      }),
      onSnapshot: () => undefined,
    });

    await session.start();
    await session.waitForIdle();

    expect(checks).toBe(2);
    expect(preparationCommits).toEqual(["conflict"]);
    expect(executed.sort()).toEqual(["one", "two"]);
    expect(session.snapshot()).toMatchObject({
      status: "failed",
      items: [
        { id: "conflict", status: "failed", error: "目标路径冲突\n待处理：/source.mp4\n目标路径：/target.mp4" },
        { id: "one", status: "success" },
        { id: "two", status: "success" },
      ],
    });
  });

  it("isolates fixture case context for every concurrently executing item", async () => {
    activateNetworkFixtureContext();
    const items = [
      { ...runItem("one"), caseId: "movie-one" },
      { ...runItem("two"), caseId: "movie-two" },
    ];
    const observed: Array<ReturnType<typeof getScrapeItemExecutionContext>> = [];
    const lateObserved: Array<ReturnType<typeof getScrapeItemExecutionContext>> = [];
    const releaseLateReads = deferred<void>();
    const lateReads: Promise<void>[] = [];
    const session = new ScrapeRunSession({
      runId: "fixture-context",
      totalItems: items.length,
      prepare: async () => ({
        items,
        concurrency: 2,
        prepareItem,
        formExecutionGroups,
        validatePrepared,
        commitPreparationItem,
        acquireItems,
        admitItem,
        executePreparedItems: executeAsGroup(async (item, _prepared) => {
          await Promise.resolve();
          observed.push(getScrapeItemExecutionContext());
          lateReads.push(
            releaseLateReads.promise.then(() => {
              lateObserved.push(getScrapeItemExecutionContext());
            }),
          );
          return terminalResult(item, "success");
        }),
        commitItems: commitAsGroup(async (_item, result) => result),
      }),
      onSnapshot: () => undefined,
    });

    await session.start();
    await session.waitForIdle();
    releaseLateReads.resolve();
    await Promise.all(lateReads);

    expect(observed).toEqual(
      expect.arrayContaining([
        { itemId: "one", relativePath: "one.mp4", caseId: "movie-one" },
        { itemId: "two", relativePath: "two.mp4", caseId: "movie-two" },
      ]),
    );
    expect(lateObserved).toEqual([undefined, undefined]);
    expect(getScrapeItemExecutionContext()).toBeUndefined();
  });

  it("keeps stable live snapshots while pausing after one committed item", async () => {
    const first = deferred<ScrapeResult>();
    const started = deferred<void>();
    const executed: string[] = [];
    const committed: string[] = [];
    const admitted: string[] = [];
    const observedStatuses: string[] = [];
    const observedRevisions: number[] = [];
    let preflightCount = 0;
    const items = [runItem("one"), runItem("two")];
    const session = new ScrapeRunSession({
      runId: "run-1",
      totalItems: items.length,
      prepare: async () => ({
        items,
        concurrency: 1,
        prepareItem,
        formExecutionGroups,
        validatePrepared: async () => {
          if (++preflightCount > 1) throw new Error("Output changed after initial preflight");
        },
        commitPreparationItem,
        acquireItems,
        admitItem: async (item) => {
          admitted.push(item.id);
          return await admitItem(item);
        },
        executePreparedItems: executeAsGroup(async (item, _prepared) => {
          executed.push(item.id);
          if (item.id === "one") {
            started.resolve();
            return await first.promise;
          }
          return terminalResult(item, "success");
        }),
        commitItems: commitAsGroup(async (item, result) => {
          committed.push(item.id);
          return { ...result, resultId: item.id };
        }),
      }),
      onSnapshot: (snapshot) => {
        observedStatuses.push(snapshot.status);
        observedRevisions.push(snapshot.revision);
      },
    });

    session.recordLog({ level: "info", message: "queued" });
    await session.start();
    await started.promise;
    session.recordStage({ stage: "Download", message: "Downloading", itemId: items[0]?.id });
    for (let index = 0; index <= MAX_LIVE_SCRAPE_LOGS; index += 1) {
      session.recordLog({ level: "info", message: `log-${index}`, itemId: items[0]?.id });
    }
    expect(session.snapshot()).toMatchObject({
      latestStage: { stage: "Download", message: "Downloading", itemId: "one", relativePath: "one.mp4" },
      logs: [
        { message: "log-1", itemId: "one", relativePath: "one.mp4" },
        ...Array.from({ length: MAX_LIVE_SCRAPE_LOGS - 2 }, () => expect.any(Object)),
        { message: `log-${MAX_LIVE_SCRAPE_LOGS}`, itemId: "one", relativePath: "one.mp4" },
      ],
    });

    await expect(session.pause()).resolves.toMatchObject({
      status: "paused",
      progress: { completedItems: 0, totalItems: 2, percent: 0 },
      items: [
        { id: "one", status: "processing" },
        { id: "two", status: "pending" },
      ],
    });
    first.resolve(terminalResult(items[0], "success"));
    await session.waitForIdle();
    expect(executed).toEqual(["one"]);
    expect(committed).toEqual(["one"]);
    expect(session.snapshot()).toMatchObject({
      status: "paused",
      progress: { completedItems: 1, totalItems: 2, percent: 50 },
      items: [
        { id: "one", status: "success" },
        { id: "two", status: "pending" },
      ],
    });

    await session.resume();
    expect(session.snapshot().status).toBe("queued");
    await session.start();
    await session.waitForIdle();
    expect(session.snapshot()).toMatchObject({
      runId: "run-1",
      generation: 0,
      status: "completed",
      progress: { completedItems: 2, totalItems: 2, percent: 100 },
      items: [
        { id: "one", status: "success", result: { resultId: "one" } },
        { id: "two", status: "success", result: { resultId: "two" } },
      ],
    });
    expect(executed).toEqual(["one", "two"]);
    expect(committed).toEqual(["one", "two"]);
    expect(admitted).toEqual(["one", "two"]);
    expect(preflightCount).toBe(1);
    expect(observedStatuses[0]).toBe("queued");
    expect(observedStatuses).toContain("running");
    expect(observedStatuses.at(-1)).toBe("completed");
    expect(observedRevisions).toEqual([...observedRevisions].sort((left, right) => left - right));
    expect(new Set(observedRevisions).size).toBe(observedRevisions.length);
    expect(observedRevisions.at(-1)).toBeGreaterThan(0);
  });

  it("keeps reported progress monotonic and floors it by terminal items", async () => {
    const first = deferred<ScrapeResult>();
    const started = deferred<void>();
    const items = [runItem("one"), runItem("two")];
    const session = new ScrapeRunSession({
      runId: "run-progress",
      totalItems: items.length,
      prepare: async () => ({
        items,
        concurrency: 1,
        prepareItem,
        formExecutionGroups,
        validatePrepared,
        commitPreparationItem,
        acquireItems,
        admitItem,
        executePreparedItems: executeAsGroup(async (item, _prepared) => {
          if (item.id === "one") {
            started.resolve();
            return await first.promise;
          }
          return terminalResult(item, "success");
        }),
        commitItems: commitAsGroup(async (_item, result) => result),
      }),
      onSnapshot: () => undefined,
    });

    await session.start();
    await started.promise;
    session.recordProgress("one", 42.4);
    session.recordProgress("one", 20);
    expect(session.snapshot().progress.percent).toBe(21);
    await session.pause();
    first.resolve(terminalResult(items[0], "success"));
    await session.waitForIdle();
    expect(session.snapshot().progress).toEqual({ completedItems: 1, totalItems: 2, percent: 50 });
    session.recordProgress("one", -10);
    expect(session.snapshot().progress.percent).toBe(50);
  });

  it("reserves 100 percent for a fully settled run", async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    const items = [runItem("one"), runItem("two")];
    const session = new ScrapeRunSession({
      runId: "run-progress-terminal",
      totalItems: items.length,
      prepare: async () => ({
        items,
        concurrency: 2,
        prepareItem,
        formExecutionGroups,
        validatePrepared,
        commitPreparationItem,
        acquireItems,
        admitItem,
        executePreparedItems: executeAsGroup(async (item) => {
          started.resolve();
          await release.promise;
          return terminalResult(item, "success");
        }),
        commitItems: commitAsGroup(async (_item, result) => result),
      }),
      onSnapshot: () => undefined,
    });

    await session.start();
    await started.promise;
    session.recordProgress("one", 100);
    session.recordProgress("two", 100);

    expect(session.snapshot().progress).toEqual({ completedItems: 0, totalItems: 2, percent: 99 });
    release.resolve();
    await session.waitForIdle();
    expect(session.snapshot().progress.percent).toBe(100);
  });

  it("aborts in-flight work and skips every unsettled item on stop", async () => {
    const started = deferred<void>();
    const aborted = deferred<void>();
    const executed: string[] = [];
    const committed: string[] = [];
    const items = [runItem("one"), runItem("two")];
    const session = new ScrapeRunSession({
      runId: "run-1",
      totalItems: items.length,
      prepare: async () => ({
        items,
        concurrency: 1,
        prepareItem,
        formExecutionGroups,
        validatePrepared,
        commitPreparationItem,
        acquireItems,
        admitItem,
        executePreparedItems: executeAsGroup(async (item, _prepared, signal) => {
          executed.push(item.id);
          started.resolve();
          await new Promise<void>((resolve) =>
            signal.addEventListener(
              "abort",
              () => {
                aborted.resolve();
                resolve();
              },
              { once: true },
            ),
          );
          throw signal.reason;
        }),
        commitItems: commitAsGroup(async (item, result) => {
          committed.push(`${item.id}:${result.status}`);
          return result;
        }),
      }),
      onSnapshot: () => undefined,
    });

    await session.start();
    await started.promise;
    const stopping = session.stop();
    await aborted.promise;
    await expect(stopping).resolves.toMatchObject({
      generation: 1,
      status: "stopped",
      progress: { completedItems: 2, totalItems: 2, percent: 100 },
    });
    expect(executed).toEqual(["one"]);
    expect(committed).toEqual(["one:skipped", "two:skipped"]);
  });

  it("aborts for shutdown without committing outcomes", async () => {
    const started = deferred<void>();
    const committed: string[] = [];
    const session = new ScrapeRunSession({
      runId: "run-1",
      totalItems: 2,
      prepare: async () => ({
        items: [runItem("one"), runItem("two")],
        concurrency: 1,
        prepareItem,
        formExecutionGroups,
        validatePrepared,
        commitPreparationItem,
        acquireItems,
        admitItem,
        executePreparedItems: executeAsGroup(async (item, _prepared, signal) => {
          started.resolve();
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
          return terminalResult(item, "success");
        }),
        commitItems: commitAsGroup(async (item, result) => {
          committed.push(item.id);
          return result;
        }),
      }),
      onSnapshot: () => undefined,
    });

    await session.start();
    await started.promise;
    await session.abortForShutdown();

    expect(committed).toEqual([]);
    expect(session.snapshot()).toMatchObject({
      generation: 1,
      status: "interrupted",
      progress: { completedItems: 0, totalItems: 2, percent: 0 },
    });
  });

  it("releases staging when stop discards a finished item before apply", async () => {
    const started = deferred<void>();
    const released: string[] = [];
    const committed: string[] = [];
    const session = new ScrapeRunSession({
      runId: "staging-discard",
      totalItems: 1,
      prepare: async () => ({
        items: [runItem("one")],
        concurrency: 1,
        prepareItem,
        formExecutionGroups,
        validatePrepared,
        commitPreparationItem,
        acquireItems,
        admitItem,
        executePreparedItems: executeAsGroup(async (item, _prepared, signal) => {
          started.resolve();
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
          return {
            ...terminalResult(item, "success"),
            release: async () => {
              released.push(item.id);
            },
          };
        }),
        commitItems: commitAsGroup(async (item, result) => {
          committed.push(`${item.id}:${result.status}`);
          return result;
        }),
      }),
      onSnapshot: () => undefined,
    });

    await session.start();
    await started.promise;
    await session.stop();
    expect(released).toEqual(["one"]);
    expect(committed).toEqual(["one:skipped"]);
  });

  it.each([
    "valid",
    "invalid",
  ])("releases every group resource when staging cleanup fails (%s results)", async (shape) => {
    const released: string[] = [];
    const session = new ScrapeRunSession({
      runId: "staging-cleanup",
      totalItems: 3,
      prepare: async () => ({
        items: [runItem("one"), runItem("two"), runItem("next")],
        concurrency: 1,
        prepareItem,
        validatePrepared,
        commitPreparationItem,
        acquireItems: (items) => () => {
          released.push(...items.map((item) => `source:${item.id}`));
        },
        formExecutionGroups: () => [
          { itemIds: ["one", "two"], publicationKeys: ["shared-output"] },
          { itemIds: ["next"], publicationKeys: ["shared-output"] },
        ],
        admitItem,
        executePreparedItems: async (entries) => ({
          results: entries.map(({ item }) => ({
            itemId: shape === "invalid" && item.id === "two" ? "unknown" : item.id,
            result: terminalResult(item, "success"),
          })),
          release: async () => {
            released.push(`staging:${entries.map(({ item }) => item.id).join(",")}`);
            if (entries.some(({ item }) => item.id === "two")) throw new Error("staging busy");
          },
        }),
        commitItems: commitAsGroup(async (_item, result) => result),
      }),
      onSnapshot: () => undefined,
    });

    await session.start();
    await session.waitForIdle();
    expect(session.snapshot()).toMatchObject({
      status: shape === "valid" ? "completed" : "failed",
      items: ["one", "two", "next"].map((id) => ({ id, status: shape === "valid" ? "success" : "skipped" })),
    });
    expect(released).toEqual([
      "staging:one,two",
      "source:one",
      "source:two",
      ...(shape === "valid" ? ["staging:next", "source:next"] : []),
    ]);
    expect(session.snapshot().logs.some((entry) => entry.message.includes("staging busy"))).toBe(true);
    if (shape === "invalid")
      expect(session.snapshot().error).toBe(
        "Scrape group execution omitted item: two; resource cleanup failed: staging busy",
      );
  });

  it("surfaces terminal persistence failure and interrupts the run", async () => {
    const session = new ScrapeRunSession({
      runId: "run-persistence-failure",
      totalItems: 1,
      prepare: async () => ({
        items: [runItem("one")],
        concurrency: 1,
        prepareItem,
        formExecutionGroups,
        validatePrepared,
        commitPreparationItem,
        acquireItems,
        admitItem,
        executePreparedItems: executeAsGroup(async () => {
          throw new Error("crawler crashed");
        }),
        commitItems: commitAsGroup(async () => {
          throw new Error("database unavailable");
        }),
      }),
      onSnapshot: () => undefined,
    });

    await session.start();
    await session.waitForIdle();

    expect(session.snapshot()).toMatchObject({
      status: "interrupted",
      error: "crawler crashed; terminal outcome persistence failed: database unavailable",
    });
    expect(session.snapshot().logs.at(-1)?.message).toContain("database unavailable");
  });
});

const configurationWithScrape = (scrape: Partial<typeof defaultConfiguration.scrape>) => ({
  ...defaultConfiguration,
  scrape: {
    ...defaultConfiguration.scrape,
    ...scrape,
  },
});

describe("scrape execution policy", () => {
  it("uses threadNumber for concurrency and creates the shared rest gate", () => {
    const policy = createScrapeExecutionPolicy(
      configurationWithScrape({
        threadNumber: 4,
        restAfterCount: 2,
        restDuration: 30,
      }),
    );

    expect(policy.concurrency).toBe(4);
    expect(policy.restGate).not.toBeNull();
  });

  it("applies only explicit site delays and clears them back to global defaults", () => {
    const calls: string[] = [];
    const client = {
      setDomainInterval: (domain: string, intervalMs: number, intervalCap?: number, concurrency?: number) => {
        calls.push(`interval:${domain}:${intervalMs}:${intervalCap}:${concurrency}`);
      },
      setDomainLimit: (domain: string, requestsPerSecond: number, concurrency?: number) => {
        calls.push(`limit:${domain}:${requestsPerSecond}:${concurrency}`);
      },
      clearDomainLimit: (domain: string) => {
        calls.push(`clear:${domain}`);
      },
    };

    applyScrapeNetworkPolicy(client, configurationWithScrape({ javdbDelaySeconds: 2 }));
    applyScrapeNetworkPolicy(client, configurationWithScrape({ javdbDelaySeconds: 0 }));

    expect(calls).toEqual([
      "interval:javdb.com:2000:1:1",
      "interval:www.javdb.com:2000:1:1",
      "clear:javdb.com",
      "clear:www.javdb.com",
    ]);
  });
});

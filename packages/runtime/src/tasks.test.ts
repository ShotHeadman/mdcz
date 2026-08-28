import { defaultConfiguration } from "@mdcz/shared/config";
import type { ScrapeResult } from "@mdcz/shared/types";
import { describe, expect, it } from "vitest";
import { applyScrapeNetworkPolicy, createScrapeExecutionPolicy } from "./scrape";
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

    const run = executor.execute([1, 2, 3], 1);
    await firstStarted;
    executor.pause();

    expect(executor.activeItems).toBe(1);
    expect(executor.isIdle).toBe(false);
    releaseFirst();
    await expect(run).resolves.toBeUndefined();
    expect(started).toEqual([1]);
    expect(applied).toEqual([1]);
  });

  it("uses a deterministic result gate to reject an obsolete execution version", async () => {
    let releaseResult!: () => void;
    let signalResult!: () => void;
    const resultBlocked = new Promise<void>((resolve) => {
      releaseResult = resolve;
    });
    const resultReached = new Promise<void>((resolve) => {
      signalResult = resolve;
    });
    let ownedExecutionVersion = 1;
    const summaries: number[] = [];
    const executor = new TaskExecutor<string, number>({
      concurrency: 1,
      runItem: async () => 42,
      gate: {
        beforeResult: async () => {
          signalResult();
          await resultBlocked;
        },
      },
      applyResult: async (_item, result, context) => {
        if (context.executionVersion !== ownedExecutionVersion) return false;
        summaries.push(result);
        return true;
      },
    });

    const run = executor.execute(["item-1"], 1);
    await resultReached;
    ownedExecutionVersion = 2;
    releaseResult();
    await run;

    expect(summaries).toEqual([]);
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

    const run = executor.execute([1, 2], 1);
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

    const run = executor.execute([1, 2], 1).finally(() => {
      settled = true;
    });
    await siblingStarted.promise;
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseSibling.resolve();
    await expect(run).rejects.toThrow("worker failed");
    expect(executor.activeItems).toBe(0);
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
  it("keeps stable live snapshots while pausing after one committed item", async () => {
    const first = deferred<ScrapeResult>();
    const started = deferred<void>();
    const executed: string[] = [];
    const committed: string[] = [];
    const observedStatuses: string[] = [];
    const items = [runItem("one"), runItem("two")];
    const session = new ScrapeRunSession({
      runId: "run-1",
      items,
      concurrency: 1,
      admitItem,
      executeItem: async (item) => {
        executed.push(item.id);
        if (item.id === "one") {
          started.resolve();
          return await first.promise;
        }
        return terminalResult(item, "success");
      },
      commitItem: async (item, result) => {
        committed.push(item.id);
        return { ...result, resultId: item.id };
      },
      onSnapshot: (snapshot) => {
        observedStatuses.push(snapshot.status);
      },
    });

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

    await session.start();
    await started.promise;
    const paused = session.pause();
    first.resolve(terminalResult(items[0], "success"));
    await expect(paused).resolves.toMatchObject({
      status: "paused",
      progress: { completedItems: 1, totalItems: 2, percent: 50 },
      items: [
        { id: "one", status: "success" },
        { id: "two", status: "pending" },
      ],
    });
    expect(executed).toEqual(["one"]);
    expect(committed).toEqual(["one"]);

    await session.resume();
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
    expect(observedStatuses[0]).toBe("queued");
    expect(observedStatuses).toContain("running");
    expect(observedStatuses.at(-1)).toBe("completed");
  });

  it.each([
    { concurrency: 1, ids: ["one"] },
    { concurrency: 2, ids: ["one", "two"] },
  ])("completes after resume while $concurrency item(s) are still settling", async ({ concurrency, ids }) => {
    const started = ids.map(() => deferred<void>());
    const releases = ids.map(() => deferred<void>());
    const items = ids.map(runItem);
    const session = new ScrapeRunSession({
      runId: `run-resume-${concurrency}`,
      items,
      concurrency,
      admitItem,
      executeItem: async (item) => {
        const index = ids.indexOf(item.id);
        started[index]?.resolve();
        await releases[index]?.promise;
        return terminalResult(item, "success");
      },
      commitItem: async (_item, result) => result,
      onSnapshot: () => undefined,
    });

    await session.start();
    await Promise.all(started.map((entry) => entry.promise));
    const paused = session.pause();
    await session.resume();
    for (const release of releases) release.resolve();
    await paused;
    await session.waitForIdle();

    expect(session.snapshot()).toMatchObject({
      status: "completed",
      progress: { completedItems: ids.length, totalItems: ids.length, percent: 100 },
    });
  });

  it("keeps reported progress monotonic and floors it by terminal items", async () => {
    const first = deferred<ScrapeResult>();
    const started = deferred<void>();
    const items = [runItem("one"), runItem("two")];
    const session = new ScrapeRunSession({
      runId: "run-progress",
      items,
      concurrency: 1,
      admitItem,
      executeItem: async (item) => {
        if (item.id === "one") {
          started.resolve();
          return await first.promise;
        }
        return terminalResult(item, "success");
      },
      commitItem: async (_item, result) => result,
      onSnapshot: () => undefined,
    });

    session.recordProgress("one", 42.4);
    session.recordProgress("one", 20);
    expect(session.snapshot().progress.percent).toBe(21);
    await session.start();
    await started.promise;
    const paused = session.pause();
    first.resolve(terminalResult(items[0], "success"));
    await paused;
    expect(session.snapshot().progress).toEqual({ completedItems: 1, totalItems: 2, percent: 50 });
    session.recordProgress("one", -10);
    expect(session.snapshot().progress.percent).toBe(50);
  });

  it("aborts in-flight work and skips every unsettled item on stop", async () => {
    const started = deferred<void>();
    const aborted = deferred<void>();
    const executed: string[] = [];
    const committed: string[] = [];
    const items = [runItem("one"), runItem("two")];
    const session = new ScrapeRunSession({
      runId: "run-1",
      items,
      concurrency: 1,
      admitItem,
      executeItem: async (item, signal) => {
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
      },
      commitItem: async (item, result) => {
        committed.push(`${item.id}:${result.status}`);
        return result;
      },
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

  it("lets an admitted terminal transaction finish before skipping remaining items on stop", async () => {
    const commitStarted = deferred<void>();
    const releaseCommit = deferred<void>();
    const committed: string[] = [];
    const items = [runItem("one"), runItem("two")];
    const session = new ScrapeRunSession({
      runId: "run-1",
      items,
      concurrency: 1,
      admitItem,
      executeItem: async (item) => terminalResult(item, "success"),
      commitItem: async (item, result) => {
        committed.push(`${item.id}:${result.status}`);
        if (item.id === "one") {
          commitStarted.resolve();
          await releaseCommit.promise;
        }
        return result;
      },
      onSnapshot: () => undefined,
    });

    await session.start();
    await commitStarted.promise;
    const stopped = session.stop();
    releaseCommit.resolve();
    await stopped;

    expect(committed).toEqual(["one:success", "two:skipped"]);
    expect(session.snapshot()).toMatchObject({
      generation: 1,
      status: "stopped",
      items: [
        { id: "one", status: "success" },
        { id: "two", status: "skipped" },
      ],
    });
  });

  it("aborts for shutdown without committing outcomes", async () => {
    const started = deferred<void>();
    const committed: string[] = [];
    const session = new ScrapeRunSession({
      runId: "run-1",
      items: [runItem("one"), runItem("two")],
      concurrency: 1,
      admitItem,
      executeItem: async (item, signal) => {
        started.resolve();
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        return terminalResult(item, "success");
      },
      commitItem: async (item, result) => {
        committed.push(item.id);
        return result;
      },
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

  it("surfaces terminal persistence failure and interrupts the run", async () => {
    const session = new ScrapeRunSession({
      runId: "run-persistence-failure",
      items: [runItem("one")],
      concurrency: 1,
      admitItem,
      executeItem: async () => {
        throw new Error("crawler crashed");
      },
      commitItem: async () => {
        throw new Error("database unavailable");
      },
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

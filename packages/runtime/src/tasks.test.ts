import { defaultConfiguration } from "@mdcz/shared/config";
import type { ScrapeResult } from "@mdcz/shared/types";
import { describe, expect, it } from "vitest";
import { applyScrapeNetworkPolicy, createScrapeExecutionPolicy } from "./scrape";
import {
  MAX_LIVE_SCRAPE_LOGS,
  type RuntimeTaskSnapshot,
  ScrapeRunLifecycle,
  ScrapeRunSession,
  TaskExecutor,
  transitionTask,
} from "./tasks";

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
    await expect(run).resolves.toEqual({ outcome: "paused", startedCount: 1, settledCount: 1, pendingCount: 2 });
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
    await expect(run).resolves.toEqual({ outcome: "stopped", startedCount: 1, settledCount: 1, pendingCount: 1 });
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
  attempt: 1,
});

const terminalResult = (
  item: { id: string; sourcePath: string },
  status: "success" | "failed" | "skipped",
): ScrapeResult => ({
  fileId: item.id,
  fileInfo: {
    filePath: item.sourcePath,
    fileName: `${item.id}.mp4`,
    extension: ".mp4",
    number: item.id,
    isSubtitled: false,
  },
  status,
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
      executeItem: async (item) => {
        executed.push(item.id);
        if (item.id === "one") {
          started.resolve();
          return await first.promise;
        }
        return terminalResult(item, "success");
      },
      commitItem: async (item, result) => {
        committed.push(`${item.id}:${item.attempt}`);
        return { ...result, resultId: `${item.id}:attempt-${item.attempt}` };
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
    expect(committed).toEqual(["one:1"]);

    await session.resume();
    await session.waitForIdle();
    expect(session.snapshot()).toMatchObject({
      runId: "run-1",
      generation: 0,
      status: "completed",
      progress: { completedItems: 2, totalItems: 2, percent: 100 },
      items: [
        { id: "one", attempt: 1, status: "success", result: { resultId: "one:attempt-1" } },
        { id: "two", attempt: 1, status: "success", result: { resultId: "two:attempt-1" } },
      ],
    });
    expect(executed).toEqual(["one", "two"]);
    expect(committed).toEqual(["one:1", "two:1"]);
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

    session.recordProgress(42.4);
    session.recordProgress(20);
    expect(session.snapshot().progress.percent).toBe(42);
    await session.start();
    await started.promise;
    const paused = session.pause();
    first.resolve(terminalResult(items[0], "success"));
    await paused;
    expect(session.snapshot().progress).toEqual({ completedItems: 1, totalItems: 2, percent: 50 });
    session.recordProgress(-10);
    expect(session.snapshot().progress.percent).toBe(50);
  });

  it("requeues a failed item as the next attempt without replaying settled work", async () => {
    const second = deferred<ScrapeResult>();
    const failureCommitted = deferred<void>();
    const secondStarted = deferred<void>();
    const executed: string[] = [];
    const committed: string[] = [];
    const items = [runItem("one"), runItem("two")];
    const session = new ScrapeRunSession<{ detailUrl: string }>({
      runId: "run-1",
      items,
      concurrency: 2,
      executeItem: async (item) => {
        executed.push(`${item.id}:${item.attempt}`);
        if (item.id === "two") {
          secondStarted.resolve();
          return await second.promise;
        }
        return terminalResult(item, item.attempt === 1 ? "failed" : "success");
      },
      commitItem: async (item, result) => {
        committed.push(`${item.id}:${item.attempt}:${result.status}`);
        if (item.id === "one" && item.attempt === 1) failureCommitted.resolve();
        return result;
      },
      onSnapshot: () => undefined,
    });

    await session.start();
    await Promise.all([failureCommitted.promise, secondStarted.promise]);
    expect(session.requeue("one", { detailUrl: "https://example.test/one" })).toBe(true);
    second.resolve(terminalResult(items[1], "success"));
    await session.waitForIdle();

    expect(executed).toEqual(["one:1", "two:1", "one:2"]);
    expect(committed).toEqual(["one:1:failed", "two:1:success", "one:2:success"]);
    expect(session.snapshot().items[0]).toMatchObject({
      id: "one",
      attempt: 2,
      status: "success",
      manualScrape: { detailUrl: "https://example.test/one" },
    });
  });

  it("stops with skipped outcomes while fencing the aborted execution result", async () => {
    const started = deferred<void>();
    const executed: string[] = [];
    const committed: string[] = [];
    const items = [runItem("one"), runItem("two")];
    const session = new ScrapeRunSession({
      runId: "run-1",
      items,
      concurrency: 1,
      executeItem: async (item, signal) => {
        executed.push(item.id);
        started.resolve();
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        return terminalResult(item, "success");
      },
      commitItem: async (item, result) => {
        committed.push(`${item.id}:${result.status}`);
        return result;
      },
      onSnapshot: () => undefined,
    });

    await session.start();
    await started.promise;
    await expect(session.stop()).resolves.toMatchObject({
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
      status: "stopped",
      progress: { completedItems: 0, totalItems: 2, percent: 0 },
    });
  });
});

describe("scrape run lifecycle", () => {
  it("creates the shared session, commits outcomes, and finalizes a durable run once", async () => {
    const events: string[] = [];
    const startedAt = new Date("2026-08-25T00:00:00.000Z");
    const lifecycle = await ScrapeRunLifecycle.create(async () => {
      events.push("create");
      return {
        manifest: { id: "run-lifecycle" },
        items: [runItem("one")],
        concurrency: 1,
        executeItem: async (item) => {
          events.push(`execute:${item.id}`);
          return terminalResult(item, "success");
        },
        commitItem: async (item, result) => {
          events.push(`commit:${item.id}:${result.status}`);
          return { ...result, resultId: "outcome-1" };
        },
        finalize: async (snapshot, options) => {
          events.push(`finalize:${snapshot.runId}:${snapshot.status}:${options.startedAt?.toISOString()}`);
        },
      };
    });

    await lifecycle.session.start();
    await lifecycle.session.waitForIdle();
    const snapshot = lifecycle.session.snapshot();
    await Promise.all([lifecycle.finalize(snapshot, { startedAt }), lifecycle.finalize(snapshot, { startedAt })]);

    expect(snapshot).toMatchObject({
      runId: "run-lifecycle",
      status: "completed",
      items: [{ id: "one", status: "success", result: { resultId: "outcome-1" } }],
    });
    expect(events).toEqual([
      "create",
      "execute:one",
      "commit:one:success",
      "finalize:run-lifecycle:completed:2026-08-25T00:00:00.000Z",
    ]);
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

const baseTask = (status: RuntimeTaskSnapshot["status"]): RuntimeTaskSnapshot => ({
  completedAt: null,
  error: null,
  id: "task-1",
  startedAt: null,
  status,
});

describe("runtime task FSM", () => {
  it("pauses, resumes, and retries through durable queued states", () => {
    const now = new Date("2026-04-30T00:00:00.000Z");
    const running = transitionTask(baseTask("queued"), { action: "start", now });
    const paused = transitionTask(running, { action: "pause", now });
    const resumed = transitionTask(paused, { action: "resume", now });
    const failed = transitionTask(resumed, { action: "fail", error: "boom", now });
    const retried = transitionTask(failed, { action: "retry", now });

    expect(running).toMatchObject({ status: "running", startedAt: now, completedAt: null, error: null });
    expect(paused.status).toBe("paused");
    expect(resumed).toMatchObject({ status: "queued", startedAt: null, completedAt: null, error: null });
    expect(failed).toMatchObject({ status: "failed", completedAt: now, error: "boom" });
    expect(retried).toMatchObject({ status: "queued", startedAt: null, completedAt: null, error: null });
  });

  it("allows paused tasks to be retried as durable queued work", () => {
    const paused = transitionTask(baseTask("queued"), { action: "pause" });
    const retried = transitionTask(paused, { action: "retry" });

    expect(retried).toMatchObject({ status: "queued", startedAt: null, completedAt: null, error: null });
  });

  it("moves running stop requests through stopping and rejects invalid transitions", () => {
    const running = transitionTask(baseTask("queued"), {
      action: "start",
      now: new Date("2026-04-30T00:00:00.000Z"),
    });
    const stopping = transitionTask(running, { action: "stop", error: "stop requested" });

    expect(stopping).toMatchObject({ status: "stopping", error: "stop requested" });
    expect(() => transitionTask(baseTask("completed"), { action: "pause" })).toThrow(
      "Invalid task transition: completed -> pause",
    );
  });
});

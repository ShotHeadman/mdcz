import { defaultConfiguration } from "@mdcz/shared/config";
import { describe, expect, it } from "vitest";
import { applyScrapeNetworkPolicy, createScrapeExecutionPolicy } from "./scrape";
import {
  type RecoverableSessionPort,
  type RuntimeTaskSnapshot,
  resolveRecoverableSession,
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

describe("recoverable session port", () => {
  it("routes recover and discard through one runtime policy", async () => {
    const calls: string[] = [];
    const port: RecoverableSessionPort<{ recoverable: boolean; pendingCount: number; failedCount: number }, string> = {
      summarize: async () => ({ recoverable: true, pendingCount: 1, failedCount: 0 }),
      recover: async () => {
        calls.push("recover");
        return "task-1";
      },
      discard: async () => {
        calls.push("discard");
      },
    };

    await expect(
      resolveRecoverableSession(port, {
        action: "recover",
        recoverMessage: "恢复任务已启动",
      }),
    ).resolves.toEqual({ success: true, message: "恢复任务已启动", task: "task-1" });
    await expect(
      resolveRecoverableSession(port, {
        action: "discard",
        discardMessage: "已放弃上次未完成的刮削任务",
      }),
    ).resolves.toEqual({ success: true, message: "已放弃上次未完成的刮削任务", task: null });
    expect(calls).toEqual(["recover", "discard"]);
  });
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

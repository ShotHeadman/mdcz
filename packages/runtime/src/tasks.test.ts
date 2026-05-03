import { defaultConfiguration } from "@mdcz/shared/config";
import { describe, expect, it } from "vitest";
import { applyScrapeNetworkPolicy, createScrapeExecutionPolicy } from "./scrape";
import {
  type RecoverableSessionPort,
  type RuntimeTaskSnapshot,
  resolveRecoverableSession,
  transitionTask,
} from "./tasks";

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

import { defaultConfiguration } from "@mdcz/shared/config";
import type { ScrapeResult } from "@mdcz/shared/types";
import { describe, expect, it, vi } from "vitest";
import { applyScrapeNetworkPolicy, createScrapeExecutionPolicy } from "./scrape";
import { type ScrapeRunExecution, type ScrapeRunItem, ScrapeRunSession, TaskExecutor } from "./tasks";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("task executor", () => {
  it.each(["pause", "stop"] as const)("settles active work and stops queue admission on %s", async (action) => {
    const started = deferred();
    const release = deferred();
    const invoked: number[] = [];
    const applied: number[] = [];
    const executor = new TaskExecutor<number, number>({
      concurrency: 1,
      runItem: async (item, { signal }) => {
        invoked.push(item);
        started.resolve();
        if (action === "stop")
          await new Promise<void>((done) => signal.addEventListener("abort", () => done(), { once: true }));
        else await release.promise;
        return item;
      },
      applyResult: async (_item, result) => {
        applied.push(result);
      },
    });
    const run = executor.execute([1, 2, 3]);
    await started.promise;
    executor[action]();
    release.resolve();
    await run;
    expect(invoked).toEqual([1]);
    expect(applied).toEqual(action === "pause" ? [1] : []);
  });

  it("applies sibling results concurrently and finalizes both when one fails", async () => {
    const siblingApplied = deferred();
    const release = deferred();
    const finalized: number[] = [];
    let settled = false;
    const executor = new TaskExecutor<number, number>({
      concurrency: 2,
      runItem: async (item) => item,
      applyResult: async (item) => {
        if (item === 1) await release.promise;
        else {
          siblingApplied.resolve();
          throw new Error("publication failed");
        }
      },
      finalizeResult: async (_item, result) => {
        finalized.push(result);
      },
    });
    const run = executor.execute([1, 2, 3]).finally(() => {
      settled = true;
    });
    await siblingApplied.promise;
    expect(settled).toBe(false);
    release.resolve();
    await expect(run).rejects.toThrow("publication failed");
    expect(finalized.sort()).toEqual([1, 2]);
  });
});

const resultFor = (item: ScrapeRunItem, status: "success" | "failed" | "skipped" = "success"): ScrapeResult => ({
  fileId: item.id,
  rootId: item.rootId,
  relativePath: item.relativePath,
  fileName: item.relativePath,
  status,
  assets: [],
  ...(status === "failed" ? { error: "member failed" } : {}),
});

const executionFor = (): ScrapeRunExecution<unknown, string> => {
  const items = ["one", "two", "independent"].map((id) => ({
    id,
    rootId: "root",
    relativePath: `${id}.mp4`,
    sourcePath: `/media/${id}.mp4`,
  }));
  return {
    items,
    movieGroups: [{ itemIds: ["one", "two"] }, { itemIds: ["independent"] }],
    concurrency: 1,
    admitItem: async (item) => `${item.id}:attempt`,
    prepareGroup: async (entries) => entries.map(({ item }) => ({ status: "prepared", prepared: item.id })),
    checkTargets: async () => undefined,
    executePreparedItems: async (entries) => ({
      results: entries.map(({ item }) => ({ itemId: item.id, result: resultFor(item) })),
    }),
    commitPreparationItem: async (_item, result) => result,
    commitItems: async (entries) =>
      entries.map(({ item, result }) => {
        if (!result) throw new Error("Missing movie result");
        return { itemId: item.id, result };
      }),
  };
};

describe("scrape movie groups", () => {
  it("retains whole-group preparation across pause and resume", async () => {
    const execution = executionFor();
    const started = deferred();
    const release = deferred();
    const prepared: string[][] = [];
    execution.prepareGroup = async (entries) => {
      prepared.push(entries.map(({ item }) => item.id));
      if (entries[0].item.id === "one") {
        started.resolve();
        await release.promise;
      }
      return entries.map(({ item }) => ({ status: "prepared", prepared: item.id }));
    };
    const execute = vi.fn(execution.executePreparedItems);
    execution.executePreparedItems = execute;
    const session = new ScrapeRunSession({
      runId: "group-pause",
      totalItems: 3,
      prepare: async () => execution,
      onSnapshot: () => undefined,
    });
    await session.start();
    await started.promise;
    await session.pause();
    release.resolve();
    await session.waitForIdle();
    expect(session.snapshot().status).toBe("paused");
    expect(prepared).toEqual([["one", "two"]]);
    expect(execute).not.toHaveBeenCalled();
    await session.resume();
    await session.start();
    await session.waitForIdle();
    expect(prepared).toEqual([["one", "two"], ["independent"]]);
    expect(execute.mock.calls.map(([entries]) => entries.map(({ item }) => item.id))).toEqual([
      ["one", "two"],
      ["independent"],
    ]);
    expect(session.snapshot()).toMatchObject({ status: "completed", progress: { completedItems: 3 } });
  });

  it("fails an entire movie when a member cannot prepare while publishing independent movies", async () => {
    const execution = executionFor();
    execution.prepareGroup = async (entries) =>
      entries.map(({ item }) =>
        item.id === "one"
          ? { status: "failed", result: resultFor(item, "failed") }
          : { status: "prepared", prepared: item.id },
      );
    const execute = vi.fn(execution.executePreparedItems);
    execution.executePreparedItems = execute;
    const session = new ScrapeRunSession({
      runId: "member-failure",
      totalItems: 3,
      prepare: async () => execution,
      onSnapshot: () => undefined,
    });
    await session.start();
    await session.waitForIdle();
    expect(execute.mock.calls.map(([entries]) => entries.map(({ item }) => item.id))).toEqual([["independent"]]);
    expect(session.snapshot().items.map((item) => item.status)).toEqual(["failed", "failed", "success"]);
  });

  it.each(["stop", "interrupt"] as const)("settles every member when a preparing movie is %s", async (action) => {
    const execution = executionFor();
    const started = deferred();
    execution.prepareGroup = async (entries, signal) => {
      started.resolve();
      await new Promise<void>((done) => signal.addEventListener("abort", () => done(), { once: true }));
      return entries.map(({ item }) => ({ status: "skipped", result: resultFor(item, "skipped") }));
    };
    const session = new ScrapeRunSession({
      runId: `group-${action}`,
      totalItems: 3,
      prepare: async () => execution,
      onSnapshot: () => undefined,
    });
    await session.start();
    await started.promise;
    if (action === "stop") await session.stop();
    else await session.abortForShutdown();
    await session.waitForIdle();
    expect(session.snapshot().status).toBe(action === "stop" ? "stopped" : "interrupted");
    if (action === "stop") expect(session.snapshot().items.every((item) => item.status === "skipped")).toBe(true);
  });
});

describe("scrape execution policy", () => {
  it("uses configured concurrency and the shared rest gate", () => {
    const policy = createScrapeExecutionPolicy({
      ...defaultConfiguration,
      scrape: { ...defaultConfiguration.scrape, threadNumber: 4, restAfterCount: 2, restDuration: 30 },
    });
    expect(policy.concurrency).toBe(4);
    expect(policy.restGate).not.toBeNull();
  });

  it("applies explicit site delays and clears them back to global defaults", () => {
    const calls: string[] = [];
    const client = {
      setDomainInterval: (domain: string, intervalMs: number, intervalCap?: number, concurrency?: number) => {
        calls.push(`interval:${domain}:${intervalMs}:${intervalCap}:${concurrency}`);
      },
      setDomainLimit: () => undefined,
      clearDomainLimit: (domain: string) => {
        calls.push(`clear:${domain}`);
      },
    };
    for (const javdbDelaySeconds of [2, 0])
      applyScrapeNetworkPolicy(client, {
        ...defaultConfiguration,
        scrape: { ...defaultConfiguration.scrape, javdbDelaySeconds },
      });
    expect(calls).toEqual([
      "interval:javdb.com:2000:1:1",
      "interval:www.javdb.com:2000:1:1",
      "clear:javdb.com",
      "clear:www.javdb.com",
    ]);
  });
});

import type { ScrapeResult } from "@mdcz/shared/types";
import { describe, expect, it, vi } from "vitest";
import { ScrapeCoordinator, type ScrapeHostPort, type ScrapeRunStore } from "./ScrapeCoordinator";
import type { ScrapeRunItem } from "./ScrapeRunSession";

type Run = {
  id: string;
  createdAt: Date;
  retryOfRunId: string | null;
  items: Array<{ id: string; rootId: string; relativePath: string }>;
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const resultFor = (item: ScrapeRunItem, status: "success" | "failed"): ScrapeResult => ({
  fileId: item.id,
  rootId: item.rootId,
  relativePath: item.relativePath,
  fileName: item.relativePath,
  status,
  assets: [],
  ...(status === "failed" ? { error: "failed" } : {}),
});

describe("ScrapeCoordinator retry", () => {
  it("starts a linked retry run through the store instead of create()", async () => {
    const original: Run = {
      id: "run-1",
      createdAt: new Date("2026-08-27T00:00:00.000Z"),
      retryOfRunId: null,
      items: [{ id: "item-1", rootId: "root-1", relativePath: "ABC-001.mp4" }],
    };
    const retryRun: Run = {
      id: "run-2",
      createdAt: new Date("2026-08-27T00:01:00.000Z"),
      retryOfRunId: "run-1",
      items: original.items,
    };
    const store: ScrapeRunStore<string, Run> = {
      create: vi.fn(async () => original),
      get: vi.fn(async (runId) => (runId === retryRun.id ? retryRun : original)),
      list: vi.fn(async () => [original, retryRun]),
      retry: vi.fn(async () => retryRun),
      finalize: vi.fn(async () => retryRun),
      interruptUnfinished: vi.fn(),
      summary: vi.fn(() => null),
      latestOutcomes: vi.fn(() => []),
    };
    const started = deferred<void>();
    const host: ScrapeHostPort<Run, undefined> = {
      runId: (run) => run.id,
      createdAt: (run) => run.createdAt,
      createExecution: async (run) => ({
        items: run.items.map((item) => ({
          id: item.id,
          rootId: item.rootId,
          relativePath: item.relativePath,
          sourcePath: `/media/${item.relativePath}`,
        })),
        concurrency: 1,
        executeItem: async (item) => {
          started.resolve();
          return resultFor(item, "failed");
        },
        commitItem: async (_item, result) => result,
      }),
      onInvalidate: () => undefined,
    };
    const coordinator = new ScrapeCoordinator(store, host);

    const snapshot = await coordinator.retry("run-1");
    await started.promise;
    await coordinator.waitForIdle();

    expect(store.retry).toHaveBeenCalledWith("run-1");
    expect(store.create).not.toHaveBeenCalled();
    expect(snapshot.runId).toBe("run-2");
    expect(retryRun.retryOfRunId).toBe("run-1");
  });
});

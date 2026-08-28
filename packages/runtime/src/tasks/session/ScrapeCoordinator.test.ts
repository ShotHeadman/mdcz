import type { ScrapeResult } from "@mdcz/shared/types";
import { describe, expect, it, vi } from "vitest";
import { ScrapeCoordinator, type ScrapeHostPort, type ScrapeRunStore } from "./ScrapeCoordinator";
import type { ScrapeRunItem } from "./ScrapeRunSession";

type Run = {
  id: string;
  createdAt: Date;
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
  it("re-enqueues the settled run through retry instead of create()", async () => {
    const original: Run = {
      id: "run-1",
      createdAt: new Date("2026-08-27T00:00:00.000Z"),
      items: [{ id: "item-1", rootId: "root-1", relativePath: "ABC-001.mp4" }],
    };
    const store: ScrapeRunStore<string, Run> = {
      create: vi.fn(async () => original),
      get: vi.fn(async () => original),
      list: vi.fn(async () => [original]),
      retry: vi.fn(async () => original),
      finalize: vi.fn(async () => original),
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
        admitItem: async (item) => `${item.id}:attempt-2`,
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
    expect(snapshot.runId).toBe("run-1");
  });

  it("rejects retry until the same run has settled", async () => {
    const run: Run = {
      id: "run-1",
      createdAt: new Date("2026-08-27T00:00:00.000Z"),
      items: [{ id: "item-1", rootId: "root-1", relativePath: "ABC-001.mp4" }],
    };
    const store: ScrapeRunStore<string, Run> = {
      create: vi.fn(async () => run),
      get: vi.fn(async () => run),
      list: vi.fn(async () => [run]),
      retry: vi.fn(async () => run),
      finalize: vi.fn(async () => run),
      summary: vi.fn(() => null),
      latestOutcomes: vi.fn(() => []),
    };
    const started = deferred<void>();
    const release = deferred<void>();
    const host: ScrapeHostPort<Run, undefined> = {
      runId: (entry) => entry.id,
      createdAt: (entry) => entry.createdAt,
      createExecution: async (entry) => ({
        items: entry.items.map((item) => ({ ...item, sourcePath: `/media/${item.relativePath}` })),
        concurrency: 1,
        admitItem: async (item) => `${item.id}:attempt`,
        executeItem: async (item) => {
          started.resolve();
          await release.promise;
          return resultFor(item, "failed");
        },
        commitItem: async (_item, result) => result,
      }),
      onInvalidate: () => undefined,
    };
    const coordinator = new ScrapeCoordinator(store, host);

    await coordinator.start("start");
    await started.promise;
    await expect(coordinator.retry(run.id)).rejects.toThrow("Scrape run is already live");
    expect(store.retry).not.toHaveBeenCalled();
    release.resolve();
    await coordinator.waitForIdle();
  });

  it("finalizes mixed item outcomes as failed", async () => {
    const run: Run = {
      id: "run-mixed",
      createdAt: new Date("2026-08-28T00:00:00.000Z"),
      items: [
        { id: "item-1", rootId: "root-1", relativePath: "ABC-001.mp4" },
        { id: "item-2", rootId: "root-1", relativePath: "ABC-002.mp4" },
      ],
    };
    const store: ScrapeRunStore<string, Run> = {
      create: vi.fn(async () => run),
      get: vi.fn(async () => run),
      list: vi.fn(async () => [run]),
      retry: vi.fn(async () => run),
      finalize: vi.fn(async () => run),
      summary: vi.fn(() => null),
      latestOutcomes: vi.fn(() => []),
    };
    const host: ScrapeHostPort<Run, undefined> = {
      runId: (entry) => entry.id,
      createdAt: (entry) => entry.createdAt,
      createExecution: async (entry) => ({
        items: entry.items.map((item) => ({ ...item, sourcePath: `/media/${item.relativePath}` })),
        concurrency: 1,
        admitItem: async (item) => `${item.id}:attempt`,
        executeItem: async (item) => resultFor(item, item.id === "item-1" ? "success" : "failed"),
        commitItem: async (_item, result) => result,
      }),
      onInvalidate: () => undefined,
    };
    const coordinator = new ScrapeCoordinator(store, host);

    await coordinator.start("start");
    await coordinator.waitForIdle();

    expect(store.finalize).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-mixed", disposition: "failed" }));
    expect(coordinator.latestSnapshot()?.status).toBe("failed");
  });
});

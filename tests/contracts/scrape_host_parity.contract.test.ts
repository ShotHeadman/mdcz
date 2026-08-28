import { MediaPathOwnership } from "@mdcz/runtime/library";
import { ScrapeCoordinator, type ScrapeHostPort, type ScrapeRunStore } from "@mdcz/runtime/tasks";
import type { ScrapeRunItem } from "@mdcz/runtime/tasks/session/ScrapeRunSession";
import type { ScrapeResult } from "@mdcz/shared/types";
import { describe, expect, it, vi } from "vitest";

type ContractRun = {
  id: string;
  createdAt: Date;
  items: Array<{ id: string; rootId: string; relativePath: string }>;
};

const resultFor = (item: ScrapeRunItem): ScrapeResult => ({
  fileId: item.id,
  rootId: item.rootId,
  relativePath: item.relativePath,
  fileName: item.relativePath,
  status: "failed",
  error: "contract failure",
  assets: [],
});

const createHost = () => {
  let nextId = 1;
  const runs: ContractRun[] = [];
  const store: ScrapeRunStore<undefined, ContractRun> = {
    create: vi.fn(async () => {
      const run = {
        id: `run-${nextId++}`,
        createdAt: new Date(),
        items: [{ id: `item-${nextId}`, rootId: "root", relativePath: "movie.mp4" }],
      };
      runs.push(run);
      return run;
    }),
    get: vi.fn(async (id) => {
      const run = runs.find((candidate) => candidate.id === id);
      if (!run) throw new Error(`missing run ${id}`);
      return run;
    }),
    list: vi.fn(async () => runs),
    retry: vi.fn(async (id) => {
      const source = runs.find((candidate) => candidate.id === id);
      if (!source) throw new Error(`missing run ${id}`);
      return source;
    }),
    finalize: vi.fn(async ({ runId }) => {
      const run = runs.find((candidate) => candidate.id === runId);
      if (!run) throw new Error(`missing run ${runId}`);
      return run;
    }),
    interruptUnfinished: vi.fn(),
    summary: vi.fn(() => null),
    latestOutcomes: vi.fn(() => []),
  };
  const host: ScrapeHostPort<ContractRun, undefined> = {
    runId: (run) => run.id,
    createdAt: (run) => run.createdAt,
    createExecution: async (run) => ({
      items: run.items.map((item) => ({ ...item, sourcePath: `/media/${item.relativePath}` })),
      concurrency: 1,
      admitItem: async (item) => `${item.id}:attempt`,
      executeItem: async (item) => resultFor(item),
      commitItem: async (_item, result) => result,
    }),
    onInvalidate: () => undefined,
  };
  return { coordinator: new ScrapeCoordinator(store, host), store };
};

describe.each(["desktop", "server"])("scrape host parity: %s", () => {
  it("uses the same linked retry and shutdown contract", async () => {
    const { coordinator, store } = createHost();
    const first = await coordinator.start(undefined);
    await coordinator.waitForIdle();
    const retry = await coordinator.retry(first.runId);
    await coordinator.waitForIdle();

    expect(store.retry).toHaveBeenCalledWith(first.runId);
    expect(retry.runId).toBe(first.runId);
    expect(store.interruptUnfinished).not.toHaveBeenCalled();

    await coordinator.abortForShutdown();
    expect(store.interruptUnfinished).toHaveBeenCalledOnce();
  });

  it("rejects a scrape and maintenance operation targeting the same media path", () => {
    const ownership = new MediaPathOwnership();
    const releaseScrape = ownership.acquire("root", "movie.mp4");
    expect(() => ownership.acquire("root", "movie.mp4")).toThrow("already being modified");
    releaseScrape();
    expect(() => ownership.acquire("root", "movie.mp4")).not.toThrow();
  });
});

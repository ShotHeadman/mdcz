import type { ScrapeResult } from "@mdcz/shared/types";
import { describe, expect, it, vi } from "vitest";
import { ScrapeCoordinator, type ScrapeHostPort, type ScrapeRunStore } from "./ScrapeCoordinator";
import type { ScrapeRunItem } from "./ScrapeRunSession";

type Run = {
  id: string;
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

const waitForAbort = async (signal: AbortSignal, gate: Promise<void>): Promise<void> => {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason));
  await Promise.race([
    gate,
    new Promise<never>((_, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason))),
        { once: true },
      );
    }),
  ]);
};

const createStore = (run: Run): ScrapeRunStore<Run> => ({
  retry: vi.fn(async () => run),
  finalize: vi.fn(async () => run),
  interruptUnfinished: vi.fn(),
});

const createHost = (
  run: Run,
  executeItem: (item: ScrapeRunItem, signal: AbortSignal) => Promise<ScrapeResult>,
  concurrency = 1,
): ScrapeHostPort<string, Run, undefined> => ({
  create: vi.fn(async () => run),
  runId: (entry) => entry.id,
  createExecution: async (entry) => ({
    items: entry.items.map((item) => ({ ...item, sourcePath: `/media/${item.relativePath}` })),
    concurrency,
    admitItem: async (item) => `${item.id}:attempt`,
    executeItem,
    commitItem: async (_item, result) => result,
  }),
  onInvalidate: vi.fn(),
});

describe("ScrapeCoordinator", () => {
  it("re-enqueues the settled run through retry instead of create()", async () => {
    const run: Run = {
      id: "run-1",
      items: [{ id: "item-1", rootId: "root-1", relativePath: "ABC-001.mp4" }],
    };
    const store = createStore(run);
    const started = deferred<void>();
    const host = createHost(run, async (item) => {
      started.resolve();
      return resultFor(item, "failed");
    });
    const coordinator = new ScrapeCoordinator(store, host);

    const snapshot = await coordinator.retry("run-1");
    await started.promise;
    await coordinator.waitForIdle();

    expect(store.retry).toHaveBeenCalledWith("run-1");
    expect(host.create).not.toHaveBeenCalled();
    expect(snapshot.runId).toBe("run-1");
    expect(host.onInvalidate).toHaveBeenCalledWith([
      expect.objectContaining({
        snapshot: expect.objectContaining({
          runId: "run-1",
          items: [expect.objectContaining({ status: "failed" })],
        }),
      }),
    ]);
  });

  it("rejects retry until the same run has settled", async () => {
    const run: Run = {
      id: "run-1",
      items: [{ id: "item-1", rootId: "root-1", relativePath: "ABC-001.mp4" }],
    };
    const store = createStore(run);
    const started = deferred<void>();
    const release = deferred<void>();
    const host = createHost(run, async (item) => {
      started.resolve();
      await release.promise;
      return resultFor(item, "failed");
    });
    const coordinator = new ScrapeCoordinator(store, host);

    await coordinator.start("start");
    await started.promise;
    await expect(coordinator.retry(run.id)).rejects.toThrow("Scrape run is already live");
    expect(store.retry).not.toHaveBeenCalled();
    release.resolve();
    await coordinator.waitForIdle();
  });

  it("resumes immediately while paused in-flight work is still settling", async () => {
    const run: Run = {
      id: "run-resume",
      items: [
        { id: "item-1", rootId: "root-1", relativePath: "ABC-001.mp4" },
        { id: "item-2", rootId: "root-1", relativePath: "ABC-002.mp4" },
      ],
    };
    const store = createStore(run);
    const started = deferred<void>();
    const release = deferred<void>();
    const executed: string[] = [];
    const host = createHost(run, async (item) => {
      executed.push(item.id);
      if (item.id === "item-1") {
        started.resolve();
        await release.promise;
      }
      return resultFor(item, "success");
    });
    const coordinator = new ScrapeCoordinator(store, host);

    await coordinator.start("start");
    await started.promise;
    await expect(coordinator.pause(run.id)).resolves.toMatchObject({ status: "paused" });
    await expect(coordinator.resume(run.id)).resolves.toMatchObject({ status: "running" });
    await expect(coordinator.resume(run.id)).resolves.toMatchObject({ status: "running" });
    expect(coordinator.liveRuns()[0]?.snapshot.status).toBe("running");

    release.resolve();
    await coordinator.waitForIdle();

    expect(executed).toEqual(["item-1", "item-2"]);
    expect(store.finalize).toHaveBeenCalledWith(expect.objectContaining({ runId: run.id, disposition: "completed" }));
  });

  it("lets two processing items finish while paused and admits the third only after resume", async () => {
    const run: Run = {
      id: "run-pause",
      items: [
        { id: "item-1", rootId: "root-1", relativePath: "ABC-001.mp4" },
        { id: "item-2", rootId: "root-1", relativePath: "ABC-002.mp4" },
        { id: "item-3", rootId: "root-1", relativePath: "ABC-003.mp4" },
      ],
    };
    const store = createStore(run);
    const processing = deferred<void>();
    const processingCommitted = deferred<void>();
    const release = deferred<void>();
    const started: string[] = [];
    const committed: string[] = [];
    const host = createHost(
      run,
      async (item, signal) => {
        started.push(item.id);
        if (started.length === 2) processing.resolve();
        if (item.id !== "item-3") await waitForAbort(signal, release.promise);
        return resultFor(item, "success");
      },
      2,
    );
    const createExecution = host.createExecution;
    host.createExecution = async (entry) => ({
      ...(await createExecution(entry, { progress: () => undefined, stage: () => undefined })),
      commitItem: async (item, result) => {
        committed.push(item.id);
        if (committed.length === 2) processingCommitted.resolve();
        return result;
      },
    });
    const coordinator = new ScrapeCoordinator(store, host);

    await coordinator.start("start");
    await processing.promise;
    await coordinator.pause(run.id);
    release.resolve();
    await processingCommitted.promise;
    expect(started).toEqual(["item-1", "item-2"]);

    await coordinator.resume(run.id);
    await coordinator.waitForIdle();

    expect(started).toEqual(["item-1", "item-2", "item-3"]);
    expect(committed).toEqual(["item-1", "item-2", "item-3"]);
  });

  it("finalizes mixed item outcomes as failed", async () => {
    const run: Run = {
      id: "run-mixed",
      items: [
        { id: "item-1", rootId: "root-1", relativePath: "ABC-001.mp4" },
        { id: "item-2", rootId: "root-1", relativePath: "ABC-002.mp4" },
      ],
    };
    const store = createStore(run);
    const host = createHost(run, async (item) => resultFor(item, item.id === "item-1" ? "success" : "failed"));
    const coordinator = new ScrapeCoordinator(store, host);

    await coordinator.start("start");
    await coordinator.waitForIdle();

    expect(store.finalize).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-mixed", disposition: "failed" }));
    expect(coordinator.liveRuns()).toEqual([]);
  });

  it("interrupts unfinished runs on shutdown", async () => {
    const run: Run = {
      id: "run-1",
      items: [{ id: "item-1", rootId: "root-1", relativePath: "ABC-001.mp4" }],
    };
    const store = createStore(run);
    const started = deferred<void>();
    const hanging = deferred<void>();
    const host = createHost(run, async (item, signal) => {
      started.resolve();
      await waitForAbort(signal, hanging.promise);
      return resultFor(item, "failed");
    });
    const coordinator = new ScrapeCoordinator(store, host);

    await coordinator.start("start");
    await started.promise;
    await coordinator.abortForShutdown();

    expect(store.interruptUnfinished).toHaveBeenCalledOnce();
    expect(coordinator.liveRuns()).toEqual([]);
  });
});

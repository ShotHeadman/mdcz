import type { ScrapeResult } from "@mdcz/shared/types";
import { describe, expect, it, vi } from "vitest";
import { PublicationConflictError } from "../../publication/conflicts";
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
  rerunDirectory: vi.fn(async () => run),
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
  describe: (entry) => ({ executionGeneration: 0, totalItems: entry.items.length }),
  createExecution: async (entry) => ({
    items: entry.items.map((item) => ({ ...item, sourcePath: `/media/${item.relativePath}` })),
    concurrency,
    admitItem: async (item) => `${item.id}:attempt`,
    prepareItem: async () => ({ status: "prepared", prepared: undefined }),
    validatePrepared: vi.fn(async () => undefined),
    acquireItems: () => () => undefined,
    executePreparedItems: async (items, signal) =>
      await Promise.all(
        items.map(async ({ item }) => ({
          itemId: item.id,
          result: await executeItem(item, signal),
        })),
      ),
    commitPreparationItem: async (_item, result) => result,
    commitItems: async (items) => items.map(({ item, result }) => ({ itemId: item.id, result })),
  }),
  onInvalidate: vi.fn(),
});

describe("ScrapeCoordinator", () => {
  it.each([
    "files",
    "empty",
    "failed",
    "stopped",
    "interrupted",
  ] as const)("accepts and settles directory discovery before a file session exists (%s)", async (outcome) => {
    const run: Run = { id: "directory", items: [{ id: "one", rootId: "root", relativePath: "one.mp4" }] };
    const store = createStore(run);
    const entered = deferred<void>();
    const release = deferred<void>();
    let fixed = false;
    let discoverySignal: AbortSignal | undefined;
    const execute = vi.fn(async (item: ScrapeRunItem) => resultFor(item, "success"));
    const host = createHost(run, execute);
    host.describe = (entry) => ({ executionGeneration: 0, totalItems: fixed ? entry.items.length : null });
    host.discover = vi.fn(async (entry, signal, report) => {
      discoverySignal = signal;
      report({ directories: 3, candidates: 1, skipped: 0, elapsedMs: 10, currentPath: "/media/sub", warnings: [] });
      entered.resolve();
      await release.promise;
      signal.throwIfAborted();
      if (outcome === "failed") throw new Error("mount unavailable");
      fixed = true;
      return { ...entry, items: outcome === "empty" ? [] : entry.items };
    });
    const createExecution = vi.fn(host.createExecution);
    host.createExecution = createExecution;
    const coordinator = new ScrapeCoordinator(store, host);
    const accepted = await coordinator.start("directory");
    expect(accepted.progress.totalItems).toBeNull();
    await entered.promise;
    expect(coordinator.liveRuns()[0].snapshot).toMatchObject({
      status: "discovering",
      progress: { percent: null, totalItems: null },
      discovery: { directories: 3, candidates: 1 },
    });
    expect(createExecution).not.toHaveBeenCalled();
    await expect(coordinator.pause(run.id)).rejects.toThrow("不支持暂停");
    if (outcome === "stopped") {
      vi.mocked(host.create).mockResolvedValueOnce({ ...run, id: "queued-directory" });
      const queued = await coordinator.start("second");
      expect(queued).toMatchObject({ runId: "queued-directory", status: "queued", progress: { totalItems: null } });
      await coordinator.stop(queued.runId);
      expect(host.discover).toHaveBeenCalledTimes(1);
      expect(store.finalize).toHaveBeenCalledWith(
        expect.objectContaining({ runId: queued.runId, disposition: "stopped" }),
      );
    }
    const termination =
      outcome === "stopped"
        ? coordinator.stop(run.id)
        : outcome === "interrupted"
          ? coordinator.abortForShutdown()
          : null;
    if (termination) expect(discoverySignal?.aborted).toBe(true);
    release.resolve();
    await termination;
    await coordinator.waitForIdle();
    expect(coordinator.liveRuns()).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(outcome === "files" ? 1 : 0);
    expect(createExecution).toHaveBeenCalledTimes(outcome === "files" ? 1 : 0);
    if (outcome === "interrupted") {
      expect(store.interruptUnfinished).toHaveBeenCalledOnce();
      expect(store.finalize).not.toHaveBeenCalled();
    } else {
      expect(store.finalize).toHaveBeenCalledTimes(outcome === "stopped" ? 2 : 1);
      expect(store.finalize).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: run.id,
          disposition: outcome === "files" || outcome === "empty" ? "completed" : outcome,
        }),
      );
    }
  });
  it("shares stop completion while an admitted publication is committing", async () => {
    const run: Run = {
      id: "stop-commit",
      items: [
        { id: "one", rootId: "root", relativePath: "one.mp4" },
        { id: "two", rootId: "root", relativePath: "two.mp4" },
      ],
    };
    const store = createStore(run);
    const committing = deferred<void>();
    const release = deferred<void>();
    const host = createHost(run, async (item) => resultFor(item, "success"));
    const create = host.createExecution;
    host.createExecution = async (entry, reporter) => ({
      ...(await create(entry, reporter)),
      commitItems: async (items) =>
        await Promise.all(
          items.map(async ({ item, result }) => {
            if (item.id === "one") {
              committing.resolve();
              await release.promise;
            }
            return { itemId: item.id, result };
          }),
        ),
    });
    const coordinator = new ScrapeCoordinator(store, host);
    await coordinator.start("start");
    await committing.promise;
    const first = coordinator.stop(run.id);
    const second = coordinator.stop(run.id);
    expect(store.finalize).not.toHaveBeenCalled();
    release.resolve();
    const snapshots = await Promise.all([first, second]);
    expect(snapshots[0]).toEqual(snapshots[1]);
    expect(snapshots[0].items.map((item) => item.status)).toEqual(["success", "skipped"]);
    expect(store.finalize).toHaveBeenCalledOnce();
  });

  it("lets overlapping stop and shutdown share one settlement", async () => {
    const run: Run = {
      id: "stop-close",
      items: [{ id: "one", rootId: "root", relativePath: "one.mp4" }],
    };
    const store = createStore(run);
    const started = deferred<void>();
    const release = deferred<void>();
    const host = createHost(run, async (item, signal) => {
      started.resolve();
      await waitForAbort(signal, release.promise);
      return resultFor(item, "success");
    });
    const coordinator = new ScrapeCoordinator(store, host);
    await coordinator.start("start");
    await started.promise;
    const stopping = coordinator.stop(run.id);
    const shuttingDown = coordinator.abortForShutdown();
    release.resolve();
    await Promise.all([stopping, shuttingDown]);
    expect(store.finalize).toHaveBeenCalledOnce();
    expect(store.interruptUnfinished).toHaveBeenCalledOnce();
  });

  it.each([
    "prepare",
    "preflight",
    "publication",
  ] as const)("isolates item failures and stops publication conflicts (%s)", async (stage) => {
    const run: Run = {
      id: `conflict-${stage}`,
      items: [
        { id: "one", rootId: "root", relativePath: "one.mp4" },
        { id: "two", rootId: "root", relativePath: "two.mp4" },
      ],
    };
    const store = createStore(run);
    const executeItem = vi.fn(async (item: ScrapeRunItem) => resultFor(item, "success"));
    const host = createHost(run, executeItem);
    host.onTerminal = vi.fn();
    const create = host.createExecution;
    host.createExecution = async (entry, reporter) => ({
      ...(await create(entry, reporter)),
      prepareItem: async (item) =>
        stage === "prepare" && item.id === "one"
          ? { status: "failed", result: resultFor(item, "failed") }
          : { status: "prepared", prepared: undefined },
      validatePrepared: async () => {
        if (stage === "preflight") throw new PublicationConflictError("/one", "/two");
      },
      commitItems: async (items) =>
        items.map(({ item, result }) => {
          if (stage === "publication" && item.id === "one" && result.status === "success")
            throw new PublicationConflictError("/one", "/two");
          return { itemId: item.id, result };
        }),
    });
    const coordinator = new ScrapeCoordinator(store, host);
    await coordinator.start("start");
    await coordinator.waitForIdle();
    expect(executeItem).toHaveBeenCalledTimes(stage === "preflight" ? 0 : 1);
    expect(host.onTerminal).toHaveBeenCalledWith(
      run,
      expect.objectContaining({
        status: "failed",
        items:
          stage === "prepare"
            ? [expect.objectContaining({ status: "failed" }), expect.objectContaining({ status: "success" })]
            : stage === "preflight"
              ? [expect.objectContaining({ status: "failed" }), expect.objectContaining({ status: "failed" })]
              : [expect.objectContaining({ status: "skipped" }), expect.objectContaining({ status: "skipped" })],
      }),
    );
    expect(store.finalize).toHaveBeenCalledOnce();
    expect(coordinator.liveRuns()).toEqual([]);
  });
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
      commitItems: async (items) =>
        items.map(({ item, result }) => {
          committed.push(item.id);
          if (committed.length === 2) processingCommitted.resolve();
          return { itemId: item.id, result };
        }),
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

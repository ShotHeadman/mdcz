import { type ScrapeRunItem, ScrapeRunSession } from "@mdcz/runtime/tasks";
import type { ScrapeResult } from "@mdcz/shared/types";
import { describe, expect, it, vi } from "vitest";
import { ServerScrapeQueue } from "./serverScrapeQueue";

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}

const deferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const resultFor = (item: ScrapeRunItem): ScrapeResult => ({
  fileId: item.id,
  fileInfo: {
    filePath: item.sourcePath,
    fileName: item.relativePath,
    extension: ".mp4",
    number: item.relativePath.replace(".mp4", ""),
    isSubtitled: false,
  },
  status: "success",
});

const item = (runId: string, ordinal: number): ScrapeRunItem => ({
  id: `${runId}-item-${ordinal}`,
  rootId: "root-1",
  relativePath: `${runId}-${ordinal}.mp4`,
  sourcePath: `/media/${runId}-${ordinal}.mp4`,
  attempt: 1,
});

describe("ServerScrapeQueue", () => {
  it("runs one FIFO entry at a time", async () => {
    const firstGate = deferred();
    const secondGate = deferred();
    const starts: string[] = [];
    const settled: string[] = [];
    const queue = new ServerScrapeQueue();
    const createSession = (runId: string, gate: Deferred) =>
      new ScrapeRunSession({
        runId,
        items: [item(runId, 0)],
        concurrency: 1,
        executeItem: async (current) => {
          starts.push(runId);
          await gate.promise;
          return resultFor(current);
        },
        commitItem: async (_current, result) => result,
        onSnapshot: () => undefined,
      });

    queue.submit({
      runId: "run-1",
      session: createSession("run-1", firstGate),
      createdAt: new Date(1),
      settle: async () => {
        settled.push("run-1");
      },
    });
    queue.submit({
      runId: "run-2",
      session: createSession("run-2", secondGate),
      createdAt: new Date(2),
      settle: async () => {
        settled.push("run-2");
      },
    });

    await vi.waitFor(() => expect(starts).toEqual(["run-1"]));
    firstGate.resolve();
    await vi.waitFor(() => expect(starts).toEqual(["run-1", "run-2"]));
    expect(settled).toEqual(["run-1"]);
    secondGate.resolve();
    await vi.waitFor(() => expect(settled).toEqual(["run-1", "run-2"]));
    expect(queue.list()).toEqual([]);
  });

  it("lets an active item settle on pause, runs the next entry, then resumes at the FIFO tail", async () => {
    const firstItemGate = deferred();
    const secondRunGate = deferred();
    const starts: string[] = [];
    const queue = new ServerScrapeQueue();
    const firstItems = [item("run-1", 0), item("run-1", 1)];
    const firstSession = new ScrapeRunSession({
      runId: "run-1",
      items: firstItems,
      concurrency: 1,
      executeItem: async (current) => {
        starts.push(current.id);
        if (current.id === firstItems[0]?.id) await firstItemGate.promise;
        return resultFor(current);
      },
      commitItem: async (_current, result) => result,
      onSnapshot: () => undefined,
    });
    const secondSession = new ScrapeRunSession({
      runId: "run-2",
      items: [item("run-2", 0)],
      concurrency: 1,
      executeItem: async (current) => {
        starts.push(current.id);
        await secondRunGate.promise;
        return resultFor(current);
      },
      commitItem: async (_current, result) => result,
      onSnapshot: () => undefined,
    });
    queue.submit({ runId: "run-1", session: firstSession, createdAt: new Date(1), settle: async () => undefined });
    queue.submit({ runId: "run-2", session: secondSession, createdAt: new Date(2), settle: async () => undefined });

    await vi.waitFor(() => expect(starts).toEqual([firstItems[0]?.id]));
    const paused = queue.pause("run-1");
    firstItemGate.resolve();
    await paused;
    await vi.waitFor(() => expect(starts).toEqual([firstItems[0]?.id, "run-2-item-0"]));

    queue.resume("run-1");
    expect(starts).toEqual([firstItems[0]?.id, "run-2-item-0"]);
    secondRunGate.resolve();
    await vi.waitFor(() => expect(starts).toEqual([firstItems[0]?.id, "run-2-item-0", firstItems[1]?.id]));
    await vi.waitFor(() => expect(queue.list()).toEqual([]));
    expect(starts.filter((id) => id === firstItems[0]?.id)).toHaveLength(1);
  });

  it("stops queued entries without starting them and settles their run", async () => {
    const activeGate = deferred();
    const starts: string[] = [];
    const settled: string[] = [];
    const queue = new ServerScrapeQueue();
    const createSession = (runId: string, gate?: Deferred) =>
      new ScrapeRunSession({
        runId,
        items: [item(runId, 0)],
        concurrency: 1,
        executeItem: async (current) => {
          starts.push(runId);
          await gate?.promise;
          return resultFor(current);
        },
        commitItem: async (_current, result) => result,
        onSnapshot: () => undefined,
      });
    queue.submit({
      runId: "run-1",
      session: createSession("run-1", activeGate),
      createdAt: new Date(1),
      settle: async () => undefined,
    });
    queue.submit({
      runId: "run-2",
      session: createSession("run-2"),
      createdAt: new Date(2),
      settle: async () => {
        settled.push("run-2");
      },
    });

    await vi.waitFor(() => expect(starts).toEqual(["run-1"]));
    const stopped = await queue.stop("run-2");
    expect(stopped.status).toBe("stopped");
    expect(starts).toEqual(["run-1"]);
    expect(settled).toEqual(["run-2"]);
    activeGate.resolve();
    await vi.waitFor(() => expect(queue.get("run-1")).toBeNull());
  });

  it("continues with the next queued run after one execution throws", async () => {
    const errors: string[] = [];
    const starts: string[] = [];
    const settled: string[] = [];
    const queue = new ServerScrapeQueue(
      () => undefined,
      (entry, error) => {
        errors.push(`${entry.runId}:${error instanceof Error ? error.message : String(error)}`);
      },
    );
    const failedSession = new ScrapeRunSession({
      runId: "run-failed",
      items: [item("run-failed", 0)],
      concurrency: 1,
      executeItem: async (current) => resultFor(current),
      commitItem: async (_current, result) => result,
      onSnapshot: () => undefined,
    });
    vi.spyOn(failedSession, "start").mockRejectedValueOnce(new Error("schedule failed"));
    const nextSession = new ScrapeRunSession({
      runId: "run-next",
      items: [item("run-next", 0)],
      concurrency: 1,
      executeItem: async (current) => {
        starts.push("run-next");
        return resultFor(current);
      },
      commitItem: async (_current, result) => result,
      onSnapshot: () => undefined,
    });

    queue.submit({
      runId: "run-failed",
      session: failedSession,
      createdAt: new Date(1),
      settle: async () => {
        settled.push("run-failed");
      },
    });
    queue.submit({
      runId: "run-next",
      session: nextSession,
      createdAt: new Date(2),
      settle: async () => {
        settled.push("run-next");
      },
    });

    await vi.waitFor(() => expect(settled).toEqual(["run-failed", "run-next"]));
    expect(errors).toEqual(["run-failed:schedule failed"]);
    expect(starts).toEqual(["run-next"]);
    expect(queue.list()).toEqual([]);
  });

  it("aborts active sessions on close without settling them", async () => {
    const settled: string[] = [];
    const queue = new ServerScrapeQueue();
    const session = new ScrapeRunSession({
      runId: "run-1",
      items: [item("run-1", 0)],
      concurrency: 1,
      executeItem: async (_current, signal) =>
        await new Promise<ScrapeResult>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), { once: true });
        }),
      commitItem: async (_current, result) => result,
      onSnapshot: () => undefined,
    });
    queue.submit({
      runId: "run-1",
      session,
      createdAt: new Date(1),
      settle: async () => {
        settled.push("run-1");
      },
    });
    await vi.waitFor(() => expect(session.snapshot().items[0]?.status).toBe("processing"));
    const abortForShutdown = vi.spyOn(session, "abortForShutdown");

    await queue.beginClose();

    expect(abortForShutdown).toHaveBeenCalledOnce();
    expect(settled).toEqual([]);
    expect(queue.list()).toEqual([]);
  });
});

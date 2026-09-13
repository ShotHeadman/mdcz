import type { ScanTask } from "@mdcz/persistence";
import { describe, expect, it, vi } from "vitest";
import { createTaskEventBus } from "../taskEvents";
import { ScanQueueService } from "./scanQueueService";

const task = (id: string, status: ScanTask["status"]): ScanTask => ({
  id,
  rootId: "root-1",
  status,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  startedAt: status === "running" ? new Date("2026-01-01T00:00:01.000Z") : null,
  completedAt: null,
  videoCount: 0,
  directoryCount: 0,
  error: null,
});

describe("ScanQueueService", () => {
  it.each([
    { operation: "start", failure: "event" },
    { operation: "retry", failure: "publish" },
  ] as const)("executes $operation even when its queued $failure notification fails", async ({
    operation,
    failure,
  }) => {
    const queued = task("notification-failure", operation === "retry" ? "failed" : "queued");
    const notificationError = new Error("notification unavailable");
    const addEvent = vi.fn(async ({ taskId, type, message }: { taskId: string; type: string; message: string }) => ({
      id: `${taskId}:${type}`,
      taskId,
      type,
      message,
      createdAt: new Date(),
    }));
    const claim = vi.fn(async () => {
      queued.status = "running";
      return queued;
    });
    const persistence = {
      getState: async () => ({
        repositories: {
          mediaRoots: { get: async () => ({ displayName: "Media" }) },
          scanTasks: {
            create: async () => queued,
            requeue: async () => {
              queued.status = "queued";
              return queued;
            },
            get: async () => queued,
            claim,
            addEvent,
            listScanResults: async () => [],
            fail: async (_id: string, error: string) => {
              queued.status = "failed";
              queued.error = error;
              return queued;
            },
            interruptUnfinished: async () => [],
          },
        },
      }),
    };
    const taskEvents = createTaskEventBus();
    if (failure === "event") addEvent.mockRejectedValueOnce(notificationError);
    if (failure === "publish")
      vi.spyOn(taskEvents, "lifecycle").mockImplementationOnce(() => {
        throw notificationError;
      });
    const service = new ScanQueueService(
      persistence as never,
      {
        get: async () => {
          if (queued.status === "running") throw new Error("scan execution failed");
          return { displayName: "Media" };
        },
      } as never,
      taskEvents,
      {} as never,
    );

    await expect(operation === "start" ? service.start(queued.rootId) : service.retry(queued.id)).rejects.toBe(
      notificationError,
    );
    await vi.waitFor(() => expect(queued).toMatchObject({ status: "failed", error: "scan execution failed" }));
    expect(claim).toHaveBeenCalledExactlyOnceWith(queued.id);
    await service.close();
  });

  it("fails queued and running tasks recovered after a backend restart", async () => {
    const tasks = new Map([task("queued", "queued"), task("running", "running")].map((item) => [item.id, item]));
    const interruptUnfinished = vi.fn(async (error: string) => {
      const interrupted = [...tasks.values()].filter((item) => item.status === "queued" || item.status === "running");
      for (const item of interrupted) {
        item.status = "failed";
        item.error = error;
        item.completedAt = new Date();
      }
      return interrupted;
    });
    const taskEvents = createTaskEventBus();
    const lifecycle = vi.spyOn(taskEvents, "lifecycle");
    const persistence = {
      getState: async () => ({
        repositories: {
          mediaRoots: { get: async () => ({ displayName: "Media" }) },
          scanTasks: {
            interruptUnfinished,
            get: async (id: string) => tasks.get(id),
            addEvent: async ({ taskId, type, message }: { taskId: string; type: string; message: string }) => ({
              id: `${taskId}:${type}`,
              taskId,
              type,
              message,
              createdAt: new Date(),
            }),
            listScanResults: async () => [],
          },
        },
      }),
    };
    const service = new ScanQueueService(persistence as never, {} as never, taskEvents, {} as never);

    await service.recoverInterrupted();

    expect([...tasks.values()]).toEqual([
      expect.objectContaining({ id: "queued", status: "failed", error: expect.stringContaining("后端已重启") }),
      expect.objectContaining({ id: "running", status: "failed", error: expect.stringContaining("后端已重启") }),
    ]);
    expect(lifecycle).toHaveBeenCalledTimes(2);
    await service.close();
  });

  it("rejects start after a drain fault and recovers through retry", async () => {
    const created: ScanTask[] = [];
    let claims = 0;
    const persistence = {
      getState: async () => ({
        repositories: {
          mediaRoots: { get: async () => ({ displayName: "Media" }) },
          scanTasks: {
            interruptUnfinished: async () => [],
            create: async ({ rootId }: { rootId: string }) => {
              const item = task(`created-${created.length + 1}`, "queued");
              item.rootId = rootId;
              created.push(item);
              return item;
            },
            get: async (id: string) => created.find((item) => item.id === id) ?? task(id, "queued"),
            claim: async () => {
              claims += 1;
              if (claims === 1) throw new Error("catalog unavailable");
              return null;
            },
            addEvent: async ({ taskId, type, message }: { taskId: string; type: string; message: string }) => ({
              id: `${taskId}:${type}`,
              taskId,
              type,
              message,
              createdAt: new Date(),
            }),
            listScanResults: async () => [],
            requeue: async (taskId: string) => created.find((item) => item.id === taskId) ?? task(taskId, "queued"),
          },
        },
      }),
    };
    const service = new ScanQueueService(
      persistence as never,
      { get: async () => ({ displayName: "Media" }) } as never,
      createTaskEventBus(),
      {} as never,
    );

    await expect(service.start("root-1")).resolves.toMatchObject({ status: "queued" });
    await vi.waitFor(async () => {
      await expect(service.start("root-1")).rejects.toThrow("Scan queue requires repair: catalog unavailable");
    });
    await expect(service.retry("created-1")).resolves.toMatchObject({ status: "queued" });
    await expect(service.start("root-1")).resolves.toMatchObject({ status: "queued" });
    await service.close();
  });
});

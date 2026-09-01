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
    const service = new ScanQueueService(persistence as never, {} as never, taskEvents);

    await service.recoverInterrupted();

    expect([...tasks.values()]).toEqual([
      expect.objectContaining({ id: "queued", status: "failed", error: expect.stringContaining("后端已重启") }),
      expect.objectContaining({ id: "running", status: "failed", error: expect.stringContaining("后端已重启") }),
    ]);
    expect(lifecycle).toHaveBeenCalledTimes(2);
    await service.close();
  });
});

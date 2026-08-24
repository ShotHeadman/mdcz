import type { ScanTaskDto } from "@mdcz/shared/serverDtos";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskEventBus } from "../taskEvents";
import { AutomationService } from "./automationService";
import type { MaintenanceService } from "./maintenanceService";
import type { ScanQueueService } from "./scanQueueService";
import type { ScrapeService } from "./scrapeService";

const makeTask = (id: string, status: ScanTaskDto["status"]): ScanTaskDto => ({
  id,
  kind: "scrape",
  rootId: "root-1",
  rootDisplayName: "Media",
  status,
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:01:00.000Z",
  startedAt: status === "queued" ? null : "2026-08-24T00:00:01.000Z",
  completedAt: status === "completed" || status === "failed" ? "2026-08-24T00:01:00.000Z" : null,
  videoCount: 1,
  directoryCount: 0,
  error: status === "failed" ? "failed" : null,
});

const createAutomationService = (taskEvents: TaskEventBus): AutomationService =>
  new AutomationService({} as ScanQueueService, {} as ScrapeService, {} as MaintenanceService, taskEvents, {
    secret: "test-secret",
    url: "http://webhook.test/events",
  });

const publishTask = (taskEvents: TaskEventBus, task: ScanTaskDto): void => {
  taskEvents.publish({ kind: "task", task });
};

const requestBodies = (fetchMock: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> =>
  fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit | undefined)?.body)));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AutomationService webhook delivery", () => {
  it("delivers only the first running and terminal transitions for each task", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const taskEvents = new TaskEventBus();
    const service = createAutomationService(taskEvents);

    publishTask(taskEvents, makeTask("task-1", "queued"));
    publishTask(taskEvents, makeTask("task-1", "running"));
    publishTask(taskEvents, makeTask("task-1", "paused"));
    publishTask(taskEvents, makeTask("task-1", "running"));
    publishTask(taskEvents, makeTask("task-1", "stopping"));
    publishTask(taskEvents, makeTask("task-1", "completed"));
    publishTask(taskEvents, makeTask("task-1", "completed"));

    await expect.poll(() => service.deliveryStatus().webhook.delivered).toBe(2);

    expect(requestBodies(fetchMock)).toEqual([
      expect.objectContaining({ taskId: "task-1", kind: "scrape", status: "running" }),
      expect.objectContaining({ taskId: "task-1", kind: "scrape", status: "completed" }),
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ "x-mdcz-webhook-secret": "test-secret" }),
    });
    expect(service.deliveryStatus().webhook).toMatchObject({ delivered: 2, failed: 0, lastError: null });
  });

  it("keeps deliveries FIFO and continues after an earlier HTTP failure", async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    let requestCount = 0;
    const fetchMock = vi.fn<typeof fetch>(() => {
      requestCount += 1;
      return requestCount === 1 ? firstResponse : Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const taskEvents = new TaskEventBus();
    const service = createAutomationService(taskEvents);

    publishTask(taskEvents, makeTask("task-1", "running"));
    publishTask(taskEvents, makeTask("task-1", "completed"));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requestBodies(fetchMock)).toEqual([expect.objectContaining({ taskId: "task-1", status: "running" })]);

    resolveFirst?.(new Response(null, { status: 503 }));
    await expect.poll(() => fetchMock.mock.calls.length).toBe(2);
    await expect.poll(() => service.deliveryStatus().webhook.delivered).toBe(1);

    expect(requestBodies(fetchMock)).toEqual([
      expect.objectContaining({ taskId: "task-1", status: "running" }),
      expect.objectContaining({ taskId: "task-1", status: "completed" }),
    ]);
    expect(service.deliveryStatus().webhook).toMatchObject({ delivered: 1, failed: 1, lastError: null });
  });

  it("uses a ten-second timeout and lets the next queued delivery proceed", async () => {
    const timeoutController = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutController.signal);
    let requestCount = 0;
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      requestCount += 1;
      if (requestCount > 1) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }

      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason ?? new Error("Webhook request aborted")),
          { once: true },
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const taskEvents = new TaskEventBus();
    const service = createAutomationService(taskEvents);

    publishTask(taskEvents, makeTask("task-1", "running"));
    publishTask(taskEvents, makeTask("task-2", "running"));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);

    timeoutController.abort(new Error("Webhook delivery timed out"));
    await expect.poll(() => fetchMock.mock.calls.length).toBe(2);
    await expect.poll(() => service.deliveryStatus().webhook.delivered).toBe(1);

    expect(requestBodies(fetchMock).map((body) => body.taskId)).toEqual(["task-1", "task-2"]);
    expect(service.deliveryStatus().webhook).toMatchObject({ delivered: 1, failed: 1, lastError: null });
  });
});

import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import type { ScanTaskDto } from "@mdcz/shared/serverDtos";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerServices } from "../services";
import { TaskEventBus } from "../taskEvents";
import { writeTaskEventsStream } from "./sse";

class TestServerResponse extends EventEmitter {
  readonly chunks: string[] = [];
  readonly writeResults: boolean[] = [];
  readonly write = vi.fn((chunk: string): boolean => {
    this.chunks.push(chunk);
    return this.writeResults.shift() ?? true;
  });
  readonly writeHead = vi.fn(() => this);
  readonly end = vi.fn(() => this);
}

type SnapshotServiceOverrides = {
  maintenance?: Pick<ServerServices["maintenance"], "list">;
  scans?: Pick<ServerServices["scans"], "list">;
  scrape?: Pick<ServerServices["scrape"], "list">;
};

const createServices = (taskEvents: TaskEventBus, overrides: SnapshotServiceOverrides = {}): ServerServices =>
  ({
    taskEvents,
    scans: { list: async () => ({ tasks: [] }) },
    scrape: { list: async () => ({ tasks: [] }) },
    maintenance: { list: async () => ({ tasks: [] }) },
    ...overrides,
  }) as unknown as ServerServices;

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const maintenanceTask = (status: "running" | "completed"): ScanTaskDto => ({
  id: "maintenance-task",
  kind: "maintenance",
  rootId: "root-1",
  rootDisplayName: "Media",
  status,
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z",
  startedAt: "2026-08-25T00:00:00.000Z",
  completedAt: status === "completed" ? "2026-08-25T00:01:00.000Z" : null,
  videoCount: 1,
  directoryCount: 1,
  error: null,
  continuity: status === "completed" ? "final" : "live",
});

afterEach(() => {
  vi.useRealTimers();
});

describe("writeTaskEventsStream", () => {
  it("sends a dispatchable JSON heartbeat event every thirty seconds", async () => {
    vi.useFakeTimers();
    const taskEvents = new TaskEventBus();
    const raw = new TestServerResponse();

    await writeTaskEventsStream(createServices(taskEvents), raw as unknown as ServerResponse);

    expect(raw.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        "content-type": "text/event-stream; charset=utf-8",
        "x-accel-buffering": "no",
      }),
    );
    expect(raw.chunks).toContain(": connected\n\n");
    expect(raw.chunks.some((chunk) => chunk.includes('data: {"kind":"snapshot","tasks":[]}'))).toBe(true);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(raw.chunks).not.toContain("event: heartbeat\ndata: {}\n\n");

    await vi.advanceTimersByTimeAsync(1);
    expect(raw.chunks).toContain("event: heartbeat\ndata: {}\n\n");
    expect(raw.chunks).not.toContain(": heartbeat\n\n");

    raw.emit("close");
    expect(taskEvents.listenerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(raw.chunks.filter((chunk) => chunk.startsWith("event: heartbeat")).length).toBe(1);
  });

  it("bounds a backpressured stream by closing it for an authoritative reconnect", async () => {
    const taskEvents = new TaskEventBus();
    const raw = new TestServerResponse();
    await writeTaskEventsStream(createServices(taskEvents), raw as unknown as ServerResponse);

    raw.writeResults.push(false);
    taskEvents.publish({ kind: "scrape-invalidated" });
    for (let index = 0; index < 300; index += 1) {
      taskEvents.publishRealtime({
        id: `log-${index}`,
        taskId: "task-1",
        createdAt: "2026-08-25T00:00:00.000Z",
        kind: "log",
        log: {
          id: `log-${index}`,
          taskId: "task-1",
          type: "live-log",
          message: `log ${index}`,
          createdAt: "2026-08-25T00:00:00.000Z",
          source: "task",
          level: "INFO",
        },
      });
    }

    const isInvalidation = (chunk: string): boolean =>
      chunk.includes("event: task-update") && chunk.includes('data: {"kind":"scrape-invalidated"}');
    expect(raw.chunks.filter(isInvalidation)).toHaveLength(1);
    expect(raw.chunks.filter((chunk) => chunk.includes('"kind":"log"'))).toHaveLength(0);
    expect(raw.end).toHaveBeenCalledTimes(1);
    expect(taskEvents.listenerCount()).toBe(0);
  });

  it("writes the initial snapshot before live updates observed while it is being read", async () => {
    const taskEvents = new TaskEventBus();
    const raw = new TestServerResponse();
    const scanSnapshot = deferred<{ tasks: ScanTaskDto[] }>();
    const stream = writeTaskEventsStream(
      createServices(taskEvents, {
        scans: { list: async () => await scanSnapshot.promise },
      }),
      raw as unknown as ServerResponse,
    );

    taskEvents.publish({ kind: "task", task: maintenanceTask("completed") });
    expect(raw.chunks.some((chunk) => chunk.includes('"status":"completed"'))).toBe(false);

    scanSnapshot.resolve({ tasks: [maintenanceTask("running")] });
    await stream;

    const snapshotIndex = raw.chunks.findIndex(
      (chunk) => chunk.includes('"kind":"snapshot"') && chunk.includes('"status":"running"'),
    );
    const completedUpdateIndex = raw.chunks.findIndex(
      (chunk) => chunk.includes('"kind":"task"') && chunk.includes('"status":"completed"'),
    );
    expect(snapshotIndex).toBeGreaterThanOrEqual(0);
    expect(completedUpdateIndex).toBeGreaterThan(snapshotIndex);

    raw.emit("close");
  });

  it("ends an initial stream whose buffered live events exceed its cap", async () => {
    const taskEvents = new TaskEventBus();
    const raw = new TestServerResponse();
    const scanSnapshot = deferred<{ tasks: [] }>();
    const stream = writeTaskEventsStream(
      createServices(taskEvents, {
        scans: { list: async () => await scanSnapshot.promise },
      }),
      raw as unknown as ServerResponse,
    );

    for (let index = 0; index < 300; index += 1) {
      taskEvents.publish({ kind: "scrape-invalidated" });
    }

    await stream;
    expect(raw.end).toHaveBeenCalledTimes(1);
    expect(taskEvents.listenerCount()).toBe(0);

    scanSnapshot.resolve({ tasks: [] });
  });
});

import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
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
}

const createServices = (taskEvents: TaskEventBus): ServerServices =>
  ({
    taskEvents,
    scans: { list: async () => ({ tasks: [] }) },
    scrape: { list: async () => ({ tasks: [] }) },
    maintenance: { list: async () => ({ tasks: [] }) },
  }) as unknown as ServerServices;

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

  it("forwards a stateless scrape invalidation and coalesces it while the socket is backpressured", async () => {
    const taskEvents = new TaskEventBus();
    const raw = new TestServerResponse();
    await writeTaskEventsStream(createServices(taskEvents), raw as unknown as ServerResponse);

    raw.writeResults.push(false);
    taskEvents.publish({ kind: "scrape-invalidated" });
    taskEvents.publish({ kind: "scrape-invalidated" });
    taskEvents.publish({ kind: "scrape-invalidated" });

    const isInvalidation = (chunk: string): boolean =>
      chunk.includes("event: task-update") && chunk.includes('data: {"kind":"scrape-invalidated"}');
    expect(raw.chunks.filter(isInvalidation)).toHaveLength(1);

    raw.emit("drain");
    expect(raw.chunks.filter(isInvalidation)).toHaveLength(2);

    raw.emit("close");
  });
});

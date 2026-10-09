import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
import { describe, expect, it, vi } from "vitest";
import type { ServerServices } from "../services";
import { RuntimeLogService } from "../services/runtimeLogService";
import { createTaskEventBus, formatSseEvent } from "../taskEvents";
import { writeTaskEventsStream } from "./sse";

const createFakeResponse = (onWriteHead: () => void): { raw: ServerResponse; chunks: string[] } => {
  const chunks: string[] = [];
  const raw = Object.assign(new EventEmitter(), {
    writableEnded: false,
    writeHead: () => {
      onWriteHead();
      return raw;
    },
    write: (chunk: string) => {
      chunks.push(chunk);
      return true;
    },
    end: vi.fn(),
  }) as unknown as ServerResponse & { emit(event: "close"): boolean };
  return { raw, chunks };
};

describe("task events SSE stream", () => {
  it("delivers buffered events and closes stalled streams without recursing through log delivery", async () => {
    const taskEvents = createTaskEventBus();
    const { raw, chunks } = createFakeResponse(() => taskEvents.invalidate("scrape-history"));

    const shutdown = new AbortController();
    await writeTaskEventsStream({ taskEvents } as ServerServices, raw, undefined, undefined, shutdown.signal);
    shutdown.abort();
    expect(raw.end).toHaveBeenCalledOnce();

    expect(chunks).toEqual([
      ": connected\n\n",
      formatSseEvent({ kind: "invalidate", resources: ["scrape-history"] }),
      formatSseEvent({ kind: "invalidate", resources: ["ready"] }),
    ]);
    expect(taskEvents.listenerCount()).toBe(0);

    const logs = new RuntimeLogService(10, taskEvents);
    const logger = vi.spyOn(runtimeLoggerService, "getLogger").mockImplementation((name) => logs.getLogger(name));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const stalled = createFakeResponse(() => undefined);
    const stopStalled = new AbortController();
    try {
      await writeTaskEventsStream(
        { taskEvents } as ServerServices,
        stalled.raw,
        undefined,
        undefined,
        stopStalled.signal,
      );
      vi.spyOn(stalled.raw, "write").mockReturnValue(false);
      expect(() => taskEvents.invalidate("maintenance")).not.toThrow();
      expect(stalled.raw.end).toHaveBeenCalledOnce();
      expect(taskEvents.listenerCount()).toBe(0);
      expect(logs.list().logs).toEqual([
        expect.objectContaining({ source: "runtime", message: expect.stringContaining("backpressured") }),
      ]);
    } finally {
      stopStalled.abort();
      logger.mockRestore();
      warn.mockRestore();
    }
  });
});

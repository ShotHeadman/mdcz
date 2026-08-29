import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { ServerServices } from "../services";
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
    end: () => {},
  }) as unknown as ServerResponse & { emit(event: "close"): boolean };
  return { raw, chunks };
};

describe("task events SSE stream", () => {
  it("delivers events published while the response headers are still being written", async () => {
    const taskEvents = createTaskEventBus();
    const { raw, chunks } = createFakeResponse(() => taskEvents.invalidate("scrape-history"));

    await writeTaskEventsStream({ taskEvents } as ServerServices, raw);
    raw.emit("close");

    expect(chunks).toEqual([
      ": connected\n\n",
      formatSseEvent({ kind: "invalidate", resources: ["scrape-history"] }),
      formatSseEvent({ kind: "invalidate", resources: ["ready"] }),
    ]);
    expect(taskEvents.listenerCount()).toBe(0);
  });
});

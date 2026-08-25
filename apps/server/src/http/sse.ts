import type { ServerResponse } from "node:http";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
import type { ServerServices } from "../services";
import { formatSseEvent, type TaskEventEnvelope } from "../taskEvents";
import { buildCorsHeaders } from "./cors";

const MAX_BOOTSTRAP_BUFFERED_EVENTS = 256;

export async function writeTaskEventsStream(
  services: ServerServices,
  raw: ServerResponse,
  origin?: string,
  requestHost?: string,
): Promise<void> {
  raw.writeHead(200, {
    ...buildCorsHeaders(origin, requestHost),
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
    "x-accel-buffering": "no",
  });
  let closed = false;
  let bootstrapping = true;
  let bufferedEvents: TaskEventEnvelope[] = [];
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;
  let cancelBootstrap: (() => void) | null = null;

  const write = (chunk: string): void => {
    if (closed) return;
    if (!raw.write(chunk)) {
      runtimeLoggerService
        .getLogger("task-sse")
        .warn("Task SSE output is backpressured; closing the stream for a full resync");
      closeStream();
    }
  };

  const writeTaskEvent = (event: TaskEventEnvelope): void => {
    write(formatSseEvent(event));
  };

  const onClose = (): void => {
    cleanup();
  };

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    cancelBootstrap?.();
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    unsubscribe?.();
    raw.removeListener("close", onClose);
  };

  const closeStream = (): void => {
    cleanup();
    if (!raw.writableEnded) raw.end();
  };

  const bufferInitialEvent = (event: TaskEventEnvelope): void => {
    if (bufferedEvents.length >= MAX_BOOTSTRAP_BUFFERED_EVENTS) {
      // The snapshot is no longer enough to cover an arbitrarily large gap.
      // End the SSE response so EventSource reconnects and starts from a new
      // authoritative snapshot rather than retaining an unbounded queue.
      closeStream();
      return;
    }
    bufferedEvents.push(event);
  };

  const bootstrapCancelled = new Promise<void>((resolve) => {
    cancelBootstrap = resolve;
  });

  raw.on("close", onClose);
  write(": connected\n\n");
  if (closed) return;

  heartbeatInterval = setInterval(() => {
    write("event: heartbeat\ndata: {}\n\n");
  }, 30_000);
  unsubscribe = services.taskEvents.subscribe((event) => {
    if (closed) return;
    if (bootstrapping) {
      bufferInitialEvent(event);
      return;
    }
    writeTaskEvent(event);
  });

  try {
    const snapshots = await Promise.race([
      Promise.all([services.scans.list(), services.scrape.list(), services.maintenance.list()]),
      bootstrapCancelled.then(() => null),
    ]);
    if (!snapshots || closed) return;

    const [scanSnapshot, scrapeSnapshot, maintenanceSnapshot] = snapshots;
    write(
      formatSseEvent({
        id: "snapshot",
        event: "task-update",
        data: {
          kind: "snapshot",
          tasks: [...scanSnapshot.tasks, ...scrapeSnapshot.tasks, ...maintenanceSnapshot.tasks],
        },
      }),
    );

    // Keep buffering until every event observed while the snapshot was read
    // has been written. This also preserves ordering if a write re-enters the
    // event bus synchronously.
    while (bufferedEvents.length > 0 && !closed) {
      const events = bufferedEvents;
      bufferedEvents = [];
      for (const event of events) {
        if (closed) return;
        writeTaskEvent(event);
      }
    }
    bootstrapping = false;
  } catch (error) {
    closeStream();
    throw error;
  }
}

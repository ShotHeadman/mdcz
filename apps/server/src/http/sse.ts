import type { ServerResponse } from "node:http";
import type { ServerServices } from "../services";
import { formatSseEvent, type TaskEventEnvelope } from "../taskEvents";
import { buildCorsHeaders } from "./cors";

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
  let streamBlocked = false;
  let pendingScrapeInvalidation: TaskEventEnvelope | null = null;

  const write = (chunk: string): boolean => {
    const accepted = raw.write(chunk);
    if (!accepted) streamBlocked = true;
    return accepted;
  };

  const writeTaskEvent = (event: TaskEventEnvelope): void => {
    if (event.data.kind === "scrape-invalidated" && streamBlocked) {
      // Progress can produce many invalidations while a slow client is backed
      // up.  The query is authoritative, so one later notification is enough.
      pendingScrapeInvalidation = event;
      return;
    }
    write(formatSseEvent(event));
  };

  const flushPendingScrapeInvalidation = (): void => {
    streamBlocked = false;
    const pending = pendingScrapeInvalidation;
    pendingScrapeInvalidation = null;
    if (pending) writeTaskEvent(pending);
  };

  raw.on("drain", flushPendingScrapeInvalidation);
  write(": connected\n\n");

  const heartbeatInterval = setInterval(() => {
    write("event: heartbeat\ndata: {}\n\n");
  }, 30_000);
  const unsubscribe = services.taskEvents.subscribe((event) => {
    writeTaskEvent(event);
  });
  const [scanSnapshot, scrapeSnapshot, maintenanceSnapshot] = await Promise.all([
    services.scans.list(),
    services.scrape.list(),
    services.maintenance.list(),
  ]);
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

  raw.on("close", () => {
    clearInterval(heartbeatInterval);
    unsubscribe();
    raw.removeListener("drain", flushPendingScrapeInvalidation);
  });
}

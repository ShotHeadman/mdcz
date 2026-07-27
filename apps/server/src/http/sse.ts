import type { ServerResponse } from "node:http";
import type { ServerServices } from "../services";
import { formatSseEvent } from "../taskEvents";
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
  raw.write(": connected\n\n");

  const heartbeatInterval = setInterval(() => {
    raw.write(": heartbeat\n\n");
  }, 30_000);
  const unsubscribe = services.taskEvents.subscribe((event) => {
    raw.write(formatSseEvent(event));
  });
  const [scanSnapshot, scrapeSnapshot, maintenanceSnapshot] = await Promise.all([
    services.scans.list(),
    services.scrape.list(),
    services.maintenance.list(),
  ]);
  raw.write(
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
  });
}

import type { ServerResponse } from "node:http";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
import type { TaskNotificationDto } from "@mdcz/shared/serverDtos";
import type { ServerServices } from "../services";
import { formatSseEvent } from "../taskEvents";
import { buildCorsHeaders } from "./cors";

export async function writeTaskEventsStream(
  services: ServerServices,
  raw: ServerResponse,
  origin?: string,
  requestHost?: string,
): Promise<void> {
  let closed = false;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;
  let bufferedNotifications: TaskNotificationDto[] | null = [];

  const write = (chunk: string): void => {
    if (closed) return;
    if (!raw.write(chunk)) {
      runtimeLoggerService
        .getLogger("task-sse")
        .warn("Task SSE output is backpressured; closing the stream for a full resync");
      closeStream();
    }
  };

  const writeNotification = (notification: TaskNotificationDto): void => {
    if (bufferedNotifications) {
      bufferedNotifications.push(notification);
      return;
    }
    write(formatSseEvent(notification));
  };

  const onClose = (): void => {
    cleanup();
  };

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    unsubscribe?.();
    raw.removeListener("close", onClose);
  };

  const closeStream = (): void => {
    cleanup();
    if (!raw.writableEnded) raw.end();
  };

  raw.on("close", onClose);
  unsubscribe = services.taskEvents.subscribe(writeNotification);
  raw.writeHead(200, {
    ...buildCorsHeaders(origin, requestHost),
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
    "x-accel-buffering": "no",
  });
  write(": connected\n\n");
  if (closed) return;

  const pending = bufferedNotifications ?? [];
  bufferedNotifications = null;
  for (const notification of pending) {
    writeNotification(notification);
    if (closed) return;
  }
  writeNotification({ kind: "invalidate", resources: ["ready"] });
  if (closed) return;

  heartbeatInterval = setInterval(() => {
    write("event: heartbeat\ndata: {}\n\n");
  }, 30_000);
}

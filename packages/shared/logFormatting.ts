import type { RuntimeLog } from "./runtimeLog";
import type { LogEntryDto } from "./serverDtos";

export type VisualLogLevel = "ok" | "info" | "warn" | "error" | "request";

const SUCCESS_MESSAGE_PATTERN = /\bmatched\b|\bsucceeded?\b|\bsuccess(?:ful|fully)?\b|完成|成功/i;

const typeLevelLabels: Record<string, LogEntryDto["level"]> = {
  completed: "OK",
  failed: "ERR",
  "item-failed": "ERR",
  "item-success": "OK",
  paused: "WARN",
  queued: "REQ",
  running: "INFO",
  stopping: "WARN",
};

export function stringifyRuntimeLogMessage(message: RuntimeLog["message"] | LogEntryDto["message"]): string {
  if (message === null || message === undefined) {
    return "";
  }

  if (typeof message === "object") {
    try {
      return JSON.stringify(message);
    } catch {
      return String(message);
    }
  }

  return message.toString();
}

export function getVisualLogLevel(log: {
  level?: string | null;
  message: RuntimeLog["message"] | LogEntryDto["message"];
  type?: string;
}): VisualLogLevel {
  const explicitLevel = log.level ?? typeLevelLabels[log.type ?? ""];
  const normalizedLevel = (explicitLevel ?? "").trim().toLowerCase();
  const message = stringifyRuntimeLogMessage(log.message);
  const normalizedMessage = message.toLowerCase();

  if (normalizedLevel === "error" || normalizedLevel === "err") {
    return "error";
  }

  if (normalizedLevel === "warn" || normalizedLevel === "warning") {
    return "warn";
  }

  if (normalizedLevel === "request" || normalizedLevel === "req") {
    return "request";
  }

  if (normalizedLevel === "ok" || normalizedLevel === "success") {
    return "ok";
  }

  if (normalizedLevel === "info") {
    return "info";
  }

  if (
    normalizedMessage.includes("error") ||
    normalizedMessage.includes("failed") ||
    normalizedMessage.includes("失败")
  ) {
    return "error";
  }

  if (normalizedMessage.includes("warn") || normalizedMessage.includes("警告")) {
    return "warn";
  }

  if (
    normalizedMessage.includes("request") ||
    normalizedMessage.includes("fetch") ||
    normalizedMessage.includes("请求")
  ) {
    return "request";
  }

  if (SUCCESS_MESSAGE_PATTERN.test(message)) {
    return "ok";
  }

  return "info";
}

export function getVisualLogLevelLabel(level: VisualLogLevel): NonNullable<LogEntryDto["level"]> {
  switch (level) {
    case "ok":
      return "OK";
    case "warn":
      return "WARN";
    case "error":
      return "ERR";
    case "request":
      return "REQ";
    default:
      return "INFO";
  }
}

export function projectLogEntryLevel(log: Pick<LogEntryDto, "level" | "message" | "type">): LogEntryDto["level"] {
  return getVisualLogLevelLabel(getVisualLogLevel(log));
}

export function getLogSearchText(log: {
  source?: string;
  type?: string;
  level?: string | null;
  taskId?: string;
  message: RuntimeLog["message"] | LogEntryDto["message"];
  createdAt?: string;
}): string {
  const visualLevel = getVisualLogLevel(log);

  return [
    log.source,
    log.type,
    log.level,
    visualLevel,
    getVisualLogLevelLabel(visualLevel),
    log.taskId,
    stringifyRuntimeLogMessage(log.message),
    log.createdAt,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
}

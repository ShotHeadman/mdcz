import type { RuntimeLog } from "@/store/logStore";

export type VisualLogLevel = "ok" | "info" | "warn" | "error" | "request";

const SUCCESS_MESSAGE_PATTERN = /\bmatched\b|\bsucceeded?\b|\bsuccess(?:ful|fully)?\b/i;

export function stringifyRuntimeLogMessage(message: RuntimeLog["message"]): string {
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

export function getVisualLogLevel(log: Pick<RuntimeLog, "level" | "message">): VisualLogLevel {
  const normalizedLevel = log.level.trim().toLowerCase();
  const message = stringifyRuntimeLogMessage(log.message);

  if (normalizedLevel === "error" || normalizedLevel === "err") {
    return "error";
  }

  if (normalizedLevel === "warn" || normalizedLevel === "warning") {
    return "warn";
  }

  if (normalizedLevel === "request") {
    return "request";
  }

  if (normalizedLevel === "ok" || normalizedLevel === "success") {
    return "ok";
  }

  if (normalizedLevel === "info" && SUCCESS_MESSAGE_PATTERN.test(message)) {
    return "ok";
  }

  return "info";
}

export function getVisualLogLevelLabel(level: VisualLogLevel): string {
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

export function getRuntimeLogSearchText(log: RuntimeLog): string {
  const visualLevel = getVisualLogLevel(log);

  return [stringifyRuntimeLogMessage(log.message), log.level, visualLevel, getVisualLogLevelLabel(visualLevel)]
    .join(" ")
    .toLowerCase();
}

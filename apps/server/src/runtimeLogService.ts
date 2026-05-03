import type { LogEntryDto, LogListInput, LogListResponse } from "@mdcz/shared/serverDtos";

type RuntimeLogLevel = NonNullable<LogEntryDto["level"]>;

const toTaskLevel = (type: string): RuntimeLogLevel => {
  if (type === "failed" || type === "item-failed") return "ERR";
  if (type === "paused" || type === "stopping") return "WARN";
  if (type === "queued") return "REQ";
  if (type === "completed" || type === "item-success") return "OK";
  return "INFO";
};

const toRuntimeLevel = (level: "debug" | "info" | "warn" | "error"): RuntimeLogLevel => {
  if (level === "error") return "ERR";
  if (level === "warn") return "WARN";
  return "INFO";
};

export const decorateTaskLog = (event: Omit<LogEntryDto, "source" | "level">): LogEntryDto => ({
  ...event,
  level: toTaskLevel(event.type),
  source: "task",
});

export class RuntimeLogService {
  private readonly entries: LogEntryDto[] = [];

  constructor(private readonly maxEntries = 1000) {}

  getLogger(source: string) {
    const write = (level: "debug" | "info" | "warn" | "error", message: string): void => {
      this.append(source, level, message);
    };

    return {
      debug: (message: string) => write("debug", message),
      error: (message: string) => write("error", message),
      info: (message: string) => write("info", message),
      warn: (message: string) => write("warn", message),
    };
  }

  append(sourceName: string, level: "debug" | "info" | "warn" | "error", message: string): LogEntryDto {
    const createdAt = new Date().toISOString();
    const entry: LogEntryDto = {
      id: `runtime-${createdAt}-${this.entries.length}`,
      taskId: sourceName,
      type: level,
      message,
      createdAt,
      level: toRuntimeLevel(level),
      source: "runtime",
    };
    this.entries.unshift(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.length = this.maxEntries;
    }
    return entry;
  }

  list(input?: LogListInput): LogListResponse {
    const kind = input?.kind ?? "all";
    if (kind === "task") return { logs: [] };
    return { logs: [...this.entries] };
  }

  clear(): number {
    const count = this.entries.length;
    this.entries.length = 0;
    return count;
  }
}

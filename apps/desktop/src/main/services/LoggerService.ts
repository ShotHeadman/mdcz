import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { app } from "electron";
import { createLogger, format, type Logger, type transport, transports } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

export interface LoggerEventPayload {
  level: string;
  text: string;
  timestamp: number;
}

const getLogDir = (): string => {
  return join(app.getPath("userData"), "logs");
};

const formatLogLine = (input: {
  timestamp?: unknown;
  level?: unknown;
  message?: unknown;
  module?: unknown;
  stack?: unknown;
}): string => {
  const timestamp = typeof input.timestamp === "string" ? input.timestamp : new Date().toISOString();
  const level = typeof input.level === "string" ? input.level.toUpperCase() : "INFO";
  const body = getLogBody(input);

  return `${timestamp} ${level}: ${body}`;
};

const getLogBody = (input: { message?: unknown; stack?: unknown }): string => {
  const bodySource = input.stack ?? input.message;
  return typeof bodySource === "string" ? bodySource : String(bodySource ?? "");
};

export class LoggerService {
  private static instance: LoggerService | null = null;

  private readonly logger: Logger;

  private readonly listeners = new Set<(payload: LoggerEventPayload) => void>();

  private fileTransport: DailyRotateFile | null = null;

  private constructor() {
    const logDir = getLogDir();

    mkdirSync(logDir, { recursive: true });

    const relayToListeners = format((info) => {
      this.notifyListeners({
        level: typeof info.level === "string" ? info.level : "info",
        text: getLogBody(info),
        timestamp: this.parseTimestamp(info.timestamp),
      });
      return info;
    });

    const configuredTransports: transport[] = [];

    this.fileTransport = new DailyRotateFile({
      filename: join(logDir, "mdcz-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      maxFiles: "14d",
      zippedArchive: true,
      level: "info",
    });
    configuredTransports.push(this.fileTransport);

    if (!app.isPackaged) {
      configuredTransports.push(
        new transports.Console({
          level: "debug",
        }),
      );
    }

    this.logger = createLogger({
      level: app.isPackaged ? "info" : "debug",
      format: format.combine(
        format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        format.errors({ stack: true }),
        relayToListeners(),
        format.printf((info) => formatLogLine(info)),
      ),
      transports: configuredTransports,
    });
  }

  static getInstance(): LoggerService {
    if (!LoggerService.instance) {
      LoggerService.instance = new LoggerService();
    }

    return LoggerService.instance;
  }

  getLogger(moduleName: string): Logger {
    return this.logger.child({ module: moduleName });
  }

  /**
   * Dynamically enable or disable file logging based on the `behavior.saveLog` config.
   */
  reconfigure(saveLog: boolean): void {
    if (!saveLog && this.fileTransport) {
      this.logger.remove(this.fileTransport);
      this.fileTransport = null;
    } else if (saveLog && !this.fileTransport) {
      const logDir = getLogDir();
      this.fileTransport = new DailyRotateFile({
        filename: join(logDir, "mdcz-%DATE%.log"),
        datePattern: "YYYY-MM-DD",
        maxFiles: "14d",
        zippedArchive: true,
        level: "info",
      });
      this.logger.add(this.fileTransport);
    }
  }

  onLog(listener: (payload: LoggerEventPayload) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.logger.end(() => resolve());
    });
  }

  private notifyListeners(payload: LoggerEventPayload): void {
    for (const listener of this.listeners) {
      listener(payload);
    }
  }

  private parseTimestamp(timestamp: unknown): number {
    if (typeof timestamp !== "string") {
      return Date.now();
    }

    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? parsed : Date.now();
  }
}

/**
 * Main-process logging is intentionally exposed as a module singleton.
 * Consumers should import this directly instead of mixing it with container injection.
 */
export const loggerService = LoggerService.getInstance();

import { join } from "node:path";
import type { RuntimeLogSink } from "@mdcz/server/services/runtimeLogService";
import { app } from "electron";
import { createLogger, format, transports } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

/** Runtime logs as daily files kept for 14 days; development also prints them. */
export const createLogFile = (directory: string): { sink: RuntimeLogSink; close: () => Promise<void> } => {
  const logger = createLogger({
    level: app.isPackaged ? "info" : "debug",
    format: format.combine(
      format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      format.printf(
        ({ timestamp, level, message, source }) => `${timestamp} ${level.toUpperCase()} [${source}]: ${message}`,
      ),
    ),
    transports: [
      new DailyRotateFile({
        filename: join(directory, "mdcz-%DATE%.log"),
        datePattern: "YYYY-MM-DD",
        maxFiles: "14d",
        zippedArchive: true,
        level: "info",
      }),
      ...(app.isPackaged ? [] : [new transports.Console()]),
    ],
  });
  return {
    sink: (level, source, message) => logger.log(level, message, { source }),
    close: () => new Promise((resolve) => logger.end(resolve)),
  };
};

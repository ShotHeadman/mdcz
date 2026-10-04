import { EventEmitter } from "node:events";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { EventChannel, EventPayloadByChannel, TaskSnapshotPayload } from "@mdcz/shared/ipcEvents";
import type { AppUpdateStatus } from "@mdcz/shared/ipcTypes";
import type { BrowserWindow } from "electron";
import { type LoggerEventPayload, loggerService } from "./LoggerService";

export class SignalService extends EventEmitter {
  private mainWindow: BrowserWindow | null;

  private readonly logger = loggerService.getLogger("Signal");

  constructor(mainWindow: BrowserWindow | null = null) {
    super();
    this.mainWindow = mainWindow;
  }

  setMainWindow(mainWindow: BrowserWindow | null): void {
    this.mainWindow = mainWindow;
  }

  showLogText(text: string, level: "info" | "warn" | "error" = "info"): void {
    this.logger.log(level, text);
  }

  forwardLoggerLog(payload: LoggerEventPayload): void {
    const level = payload.level === "warn" || payload.level === "error" ? payload.level : "info";
    this.send(IpcChannel.Event_Log, {
      text: payload.text,
      level,
      timestamp: payload.timestamp,
    });
  }

  invalidate(...resources: Array<"scrape" | "maintenance" | "overview">): void {
    this.send(IpcChannel.Event_Invalidate, { resources: [...new Set(resources)] });
  }

  publishTaskSnapshot(payload: TaskSnapshotPayload): void {
    this.send(IpcChannel.Event_TaskSnapshot, payload);
  }

  publishUpdateStatus(payload: AppUpdateStatus): void {
    this.send(IpcChannel.Event_UpdateStatus, payload);
  }

  private send<TChannel extends EventChannel>(channel: TChannel, payload: EventPayloadByChannel[TChannel]): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    this.mainWindow.webContents.send(channel, payload);
    this.emit(channel, payload);
  }
}

import { EventEmitter } from "node:events";
import { IpcChannel } from "@shared/IpcChannel";
import type {
  ButtonStatusPayload,
  EventChannel,
  EventPayloadByChannel,
  FailedInfoPayload,
  ProgressPayload,
  ScrapeInfoPayload,
} from "@shared/ipcEvents";
import type { MaintenanceItemResult, ScrapeResult } from "@shared/types";
import type { BrowserWindow } from "electron";
import { type LoggerEventPayload, loggerService } from "./LoggerService";

export class SignalService extends EventEmitter {
  private mainWindow: BrowserWindow | null;

  private readonly logger = loggerService.getLogger("Signal");

  /** High-water mark to prevent progress bar from jumping backwards during concurrent scraping. */
  private progressHighWater = 0;

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

  /** Reset progress high-water mark and send a zero-progress event. Call this before every new task. */
  resetProgress(): void {
    this.progressHighWater = 0;
    this.send(IpcChannel.Event_Progress, { value: 0, current: 0, total: 0 } satisfies ProgressPayload);
  }

  setProgress(value: number, current: number, total: number): void {
    const clampedValue = Math.max(this.progressHighWater, value);
    this.progressHighWater = clampedValue;

    const payload: ProgressPayload = {
      value: clampedValue,
      current,
      total,
    };

    this.send(IpcChannel.Event_Progress, payload);
  }

  showScrapeInfo(payload: ScrapeInfoPayload): void {
    this.send(IpcChannel.Event_ScrapeInfo, payload);
  }

  showScrapeResult(payload: ScrapeResult): void {
    this.send(IpcChannel.Event_ScrapeResult, payload);
  }

  showFailedInfo(payload: FailedInfoPayload): void {
    this.send(IpcChannel.Event_FailedInfo, payload);
  }

  setButtonStatus(startEnabled: boolean, stopEnabled: boolean): void {
    const payload: ButtonStatusPayload = {
      startEnabled,
      stopEnabled,
    };

    this.send(IpcChannel.Event_ButtonStatus, payload);
  }

  showMaintenanceItemResult(payload: MaintenanceItemResult): void {
    this.send(IpcChannel.Event_MaintenanceItemResult, payload);
  }

  private send<TChannel extends EventChannel>(channel: TChannel, payload: EventPayloadByChannel[TChannel]): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    this.mainWindow.webContents.send(channel, payload);
    this.emit(channel, payload);
  }
}

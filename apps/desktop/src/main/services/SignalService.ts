import { EventEmitter } from "node:events";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { EventChannel, EventPayloadByChannel } from "@mdcz/shared/ipcEvents";
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

  resetProgress(): void {
    this.invalidate("scrape", "maintenance");
  }

  setProgress(_value: number, _current: number, _total: number): void {
    this.invalidate("scrape", "maintenance");
  }

  showScrapeInfo(_payload: unknown): void {
    this.invalidate("scrape");
  }

  showScrapeResult(_payload: unknown): void {
    this.invalidate("scrape");
  }

  showFailedInfo(_payload: unknown): void {
    this.invalidate("scrape");
  }

  setButtonStatus(_startEnabled: boolean, _stopEnabled: boolean): void {
    this.invalidate("scrape", "overview");
  }

  invalidate(...resources: Array<"scrape" | "maintenance" | "overview">): void {
    this.send(IpcChannel.Event_Invalidate, { resources: [...new Set(resources)] });
  }

  private send<TChannel extends EventChannel>(channel: TChannel, payload: EventPayloadByChannel[TChannel]): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    this.mainWindow.webContents.send(channel, payload);
    this.emit(channel, payload);
  }
}

/// <reference types="vite/client" />
import type { Website } from "@shared/enums";
import type { IpcChannel } from "@shared/IpcChannel";
import type { FileInfo, MaintenanceItemResult, ScrapeResult } from "@shared/types";

type Unsubscribe = () => void;

interface LogPayload {
  text: string;
  level?: "info" | "warn" | "error";
  timestamp: number;
}

interface ProgressPayload {
  value: number;
  current: number;
  total: number;
}

interface ScrapeInfoPayload {
  fileInfo: FileInfo;
  site: Website;
  step: "search" | "parse" | "download" | "organize";
}

interface FailedInfoPayload {
  fileInfo: FileInfo;
  error: string;
  site?: Website;
}

interface ButtonStatusPayload {
  startEnabled: boolean;
  stopEnabled: boolean;
}

interface ShortcutPayload {
  action: string;
  shortcut?: string;
}

interface ElectronBridge {
  openPath: (path: string) => Promise<string>;
}

interface WindowApi {
  invoke: (channel: IpcChannel, payload?: unknown) => Promise<unknown>;
  on: <TChannel extends keyof EventPayloadByChannel>(
    channel: TChannel,
    callback: (payload: EventPayloadByChannel[TChannel]) => void,
  ) => Unsubscribe;
}

type EventPayloadByChannel = {
  [IpcChannel.Event_Log]: LogPayload;
  [IpcChannel.Event_Progress]: ProgressPayload;
  [IpcChannel.Event_ScrapeResult]: ScrapeResult;
  [IpcChannel.Event_ScrapeInfo]: ScrapeInfoPayload;
  [IpcChannel.Event_FailedInfo]: FailedInfoPayload;
  [IpcChannel.Event_ButtonStatus]: ButtonStatusPayload;
  [IpcChannel.Event_Shortcut]: ShortcutPayload;
  [IpcChannel.Event_MaintenanceItemResult]: MaintenanceItemResult;
};

declare global {
  interface Window {
    api: WindowApi;
    electron?: ElectronBridge;
  }
}

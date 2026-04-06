import type { Website } from "./enums";
import { IpcChannel } from "./IpcChannel";
import type { FileInfo, MaintenanceItemResult, ScrapeResult } from "./types";

export type RendererShortcutAction =
  | "start-or-stop-scrape"
  | "search-by-number"
  | "search-by-url"
  | "delete-file"
  | "delete-file-and-folder"
  | "open-folder"
  | "edit-nfo"
  | "play-video";

export interface LogPayload {
  text: string;
  level?: "info" | "warn" | "error";
  timestamp: number;
}

export interface ProgressPayload {
  value: number;
  current: number;
  total: number;
}

export interface ScrapeInfoPayload {
  fileInfo: FileInfo;
  site: Website;
  step: "search" | "parse" | "download" | "organize";
}

export interface FailedInfoPayload {
  fileInfo: FileInfo;
  error: string;
  site?: Website;
}

export interface ButtonStatusPayload {
  startEnabled: boolean;
  stopEnabled: boolean;
}

export interface ShortcutPayload {
  action: RendererShortcutAction;
  shortcut?: string;
}

export type EventPayloadByChannel = {
  [IpcChannel.Event_Log]: LogPayload;
  [IpcChannel.Event_Progress]: ProgressPayload;
  [IpcChannel.Event_ScrapeResult]: ScrapeResult;
  [IpcChannel.Event_ScrapeInfo]: ScrapeInfoPayload;
  [IpcChannel.Event_FailedInfo]: FailedInfoPayload;
  [IpcChannel.Event_ButtonStatus]: ButtonStatusPayload;
  [IpcChannel.Event_Shortcut]: ShortcutPayload;
  [IpcChannel.Event_MaintenanceItemResult]: MaintenanceItemResult;
};

export type EventChannel = keyof EventPayloadByChannel;

export const IPC_EVENT_CHANNELS = [
  IpcChannel.Event_Log,
  IpcChannel.Event_Progress,
  IpcChannel.Event_ScrapeResult,
  IpcChannel.Event_ScrapeInfo,
  IpcChannel.Event_FailedInfo,
  IpcChannel.Event_ButtonStatus,
  IpcChannel.Event_Shortcut,
  IpcChannel.Event_MaintenanceItemResult,
] as const satisfies readonly EventChannel[];

const EVENT_CHANNEL_SET = new Set<string>(IPC_EVENT_CHANNELS);

export const isEventChannel = (channel: string): channel is EventChannel => EVENT_CHANNEL_SET.has(channel);

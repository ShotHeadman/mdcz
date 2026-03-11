import type { Website } from "@shared/enums";

import { IpcChannel } from "@shared/IpcChannel";
import type { FileInfo, MaintenanceItemResult, ScrapeResult } from "@shared/types";
import { contextBridge, type IpcRendererEvent, ipcRenderer, shell } from "electron";

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

type EventChannel =
  | IpcChannel.Event_Log
  | IpcChannel.Event_Progress
  | IpcChannel.Event_ScrapeResult
  | IpcChannel.Event_ScrapeInfo
  | IpcChannel.Event_FailedInfo
  | IpcChannel.Event_ButtonStatus
  | IpcChannel.Event_Shortcut
  | IpcChannel.Event_MaintenanceItemResult;

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

const EVENT_CHANNELS = new Set<EventChannel>([
  IpcChannel.Event_Log,
  IpcChannel.Event_Progress,
  IpcChannel.Event_ScrapeResult,
  IpcChannel.Event_ScrapeInfo,
  IpcChannel.Event_FailedInfo,
  IpcChannel.Event_ButtonStatus,
  IpcChannel.Event_Shortcut,
  IpcChannel.Event_MaintenanceItemResult,
]);

const listen = <TChannel extends EventChannel>(
  channel: TChannel,
  callback: (payload: EventPayloadByChannel[TChannel]) => void,
): Unsubscribe => {
  const listener = (_event: IpcRendererEvent, payload: EventPayloadByChannel[TChannel]): void => {
    try {
      callback(payload);
    } catch (error) {
      console.error("listener callback failed", {
        channel,
        error,
      });
    }
  };

  ipcRenderer.on(channel, listener);

  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
};

contextBridge.exposeInMainWorld("api", {
  invoke: (channel: IpcChannel, payload?: unknown): Promise<unknown> => ipcRenderer.invoke(channel, payload),
  on: <TChannel extends EventChannel>(
    channel: TChannel,
    callback: (payload: EventPayloadByChannel[TChannel]) => void,
  ): Unsubscribe => {
    if (!EVENT_CHANNELS.has(channel)) {
      throw new Error(`Unsupported event channel: ${channel}`);
    }
    return listen(channel, callback);
  },
});

contextBridge.exposeInMainWorld("electron", {
  openPath: (targetPath: string): Promise<string> => shell.openPath(targetPath),
});

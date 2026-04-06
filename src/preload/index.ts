import type { IpcChannel } from "@shared/IpcChannel";
import type { EventChannel, EventPayloadByChannel } from "@shared/ipcEvents";
import { isEventChannel } from "@shared/ipcEvents";
import { contextBridge, type IpcRendererEvent, ipcRenderer, shell } from "electron";

type Unsubscribe = () => void;

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
    if (!isEventChannel(channel)) {
      throw new Error(`Unsupported event channel: ${channel}`);
    }
    return listen(channel, callback);
  },
});

contextBridge.exposeInMainWorld("electron", {
  openPath: (targetPath: string): Promise<string> => shell.openPath(targetPath),
});

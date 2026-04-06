/// <reference types="vite/client" />
import type { IpcChannel } from "@shared/IpcChannel";
import type { EventChannel, EventPayloadByChannel } from "@shared/ipcEvents";

type Unsubscribe = () => void;

interface ElectronBridge {
  openPath: (path: string) => Promise<string>;
}

interface WindowApi {
  invoke: (channel: IpcChannel, payload?: unknown) => Promise<unknown>;
  on: <TChannel extends EventChannel>(
    channel: TChannel,
    callback: (payload: EventPayloadByChannel[TChannel]) => void,
  ) => Unsubscribe;
}

declare global {
  interface Window {
    api: WindowApi;
    electron?: ElectronBridge;
  }
}

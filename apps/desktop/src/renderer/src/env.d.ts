/// <reference types="vite/client" />
import type { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { EventChannel, EventPayloadByChannel } from "@mdcz/shared/ipcEvents";

type Unsubscribe = () => void;

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
  }
}

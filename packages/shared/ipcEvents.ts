import { IpcChannel } from "./IpcChannel";
import type { MaintenanceActiveSessionSnapshot } from "./maintenanceTasks";
import type { ScrapeRunSnapshotDto } from "./serverDtos";

export type TaskSnapshotPayload =
  | { resource: "maintenance"; snapshot: MaintenanceActiveSessionSnapshot | null }
  | { resource: "scrape"; snapshot: ScrapeRunSnapshotDto | null };

export type RendererShortcutAction =
  | "start-or-stop-scrape"
  | "retry-scrape"
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

export interface InvalidatePayload {
  resources: Array<"scrape" | "maintenance" | "overview">;
}

export interface ShortcutPayload {
  action: RendererShortcutAction;
  shortcut?: string;
}

export type EventPayloadByChannel = {
  [IpcChannel.Event_TaskSnapshot]: TaskSnapshotPayload;
  [IpcChannel.Event_Log]: LogPayload;
  [IpcChannel.Event_Invalidate]: InvalidatePayload;
  [IpcChannel.Event_Shortcut]: ShortcutPayload;
};

export type EventChannel = keyof EventPayloadByChannel;

export const IPC_EVENT_CHANNELS = [
  IpcChannel.Event_TaskSnapshot,
  IpcChannel.Event_Log,
  IpcChannel.Event_Invalidate,
  IpcChannel.Event_Shortcut,
] as const satisfies readonly EventChannel[];

const EVENT_CHANNEL_SET = new Set<string>(IPC_EVENT_CHANNELS);

export const isEventChannel = (channel: string): channel is EventChannel => EVENT_CHANNEL_SET.has(channel);

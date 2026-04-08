import type { Configuration } from "../config";
import { IpcChannel } from "../IpcChannel";
import type { IpcProcedure } from "../ipcTypes";
import type { NamingPreviewItem } from "../types";

export type ConfigIpcContract = {
  [IpcChannel.Config_Get]: IpcProcedure<{ path?: string }, Configuration | unknown>;
  [IpcChannel.Config_Save]: IpcProcedure<{ config?: Partial<Configuration> }, { success: true }>;
  [IpcChannel.Config_List]: IpcProcedure<void, { configPath: string; dataDir: string }>;
  [IpcChannel.Config_Reset]: IpcProcedure<{ path?: string }, { success: true }>;
  [IpcChannel.Config_PreviewNaming]: IpcProcedure<{ config?: Partial<Configuration> }, { items: NamingPreviewItem[] }>;
  [IpcChannel.Config_ListProfiles]: IpcProcedure<void, { profiles: string[]; active: string }>;
  [IpcChannel.Config_CreateProfile]: IpcProcedure<{ name?: string }, { success: true }>;
  [IpcChannel.Config_SwitchProfile]: IpcProcedure<{ name?: string }, { success: true }>;
  [IpcChannel.Config_DeleteProfile]: IpcProcedure<{ name?: string }, { success: true }>;
};

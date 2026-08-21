import type { Configuration } from "../config";
import { IpcChannel } from "../IpcChannel";
import type { IpcProcedure } from "../ipcTypes";
import type { ConfigPathInput, ConfigUpdateInput } from "../serverDtos";
import type { NamingPreviewItem } from "../types";

export type ConfigIpcContract = {
  [IpcChannel.Config_Get]: IpcProcedure<ConfigPathInput, Configuration | unknown>;
  [IpcChannel.Config_GetDefaults]: IpcProcedure<void, Configuration>;
  [IpcChannel.Config_Save]: IpcProcedure<{ config?: ConfigUpdateInput }, { success: true }>;
  [IpcChannel.Config_List]: IpcProcedure<void, { configPath: string; dataDir: string }>;
  [IpcChannel.Config_Reset]: IpcProcedure<{ path?: string }, { success: true }>;
  [IpcChannel.Config_PreviewNaming]: IpcProcedure<{ config?: Partial<Configuration> }, { items: NamingPreviewItem[] }>;
  [IpcChannel.Config_ListProfiles]: IpcProcedure<void, { profiles: string[]; active: string }>;
  [IpcChannel.Config_CreateProfile]: IpcProcedure<{ name?: string }, { success: true }>;
  [IpcChannel.Config_SwitchProfile]: IpcProcedure<{ name?: string }, { success: true }>;
  [IpcChannel.Config_DeleteProfile]: IpcProcedure<{ name?: string }, { success: true }>;
  [IpcChannel.Config_ExportProfile]: IpcProcedure<
    { name?: string },
    { canceled: boolean; filePath: string | null; profileName: string }
  >;
  [IpcChannel.Config_ImportProfile]: IpcProcedure<
    { filePath?: string; name?: string; overwrite?: boolean },
    { success: true; profileName: string; overwritten: boolean; active: boolean }
  >;
};

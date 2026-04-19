import { IpcChannel } from "../IpcChannel";
import type { AppInfo, IpcProcedure } from "../ipcTypes";

export type AppIpcContract = {
  [IpcChannel.App_Info]: IpcProcedure<void, AppInfo>;
  [IpcChannel.App_OpenExternal]: IpcProcedure<{ url: string }, { success: true }>;
  [IpcChannel.App_PlayMedia]: IpcProcedure<{ path?: string }, { success: true }>;
  [IpcChannel.App_Relaunch]: IpcProcedure<void, { success: true }>;
  [IpcChannel.App_SyncTitleBarTheme]: IpcProcedure<{ isDark: boolean }, { success: true }>;
};

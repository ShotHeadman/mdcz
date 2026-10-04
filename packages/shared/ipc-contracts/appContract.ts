import { IpcChannel } from "../IpcChannel";
import type { AppInfo, AppUpdateStatus, IpcProcedure, WatermarkDirectoryInfo } from "../ipcTypes";
import type { LocalFileTarget } from "../mediaRef";

export type AppIpcContract = {
  [IpcChannel.App_Info]: IpcProcedure<void, AppInfo>;
  [IpcChannel.App_OpenExternal]: IpcProcedure<{ url: string }, { success: true }>;
  [IpcChannel.App_PlayMedia]: IpcProcedure<{ path: LocalFileTarget }, { success: true }>;
  [IpcChannel.App_ShowItemInFolder]: IpcProcedure<{ path: LocalFileTarget }, { success: true }>;
  [IpcChannel.App_EnsureWatermarkDirectory]: IpcProcedure<void, WatermarkDirectoryInfo>;
  [IpcChannel.App_OpenWatermarkDirectory]: IpcProcedure<void, { success: true }>;
  [IpcChannel.App_Relaunch]: IpcProcedure<void, { success: true }>;
  [IpcChannel.App_SyncTitleBarTheme]: IpcProcedure<{ isDark: boolean }, { success: true }>;
  [IpcChannel.App_GetUpdateStatus]: IpcProcedure<void, AppUpdateStatus>;
  [IpcChannel.App_CheckForUpdate]: IpcProcedure<void, AppUpdateStatus>;
  [IpcChannel.App_DownloadUpdate]: IpcProcedure<void, { success: true }>;
  [IpcChannel.App_InstallUpdate]: IpcProcedure<void, { success: true }>;
};

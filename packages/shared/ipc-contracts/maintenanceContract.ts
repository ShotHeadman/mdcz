import { IpcChannel } from "../IpcChannel";
import type { IpcProcedure } from "../ipcTypes";
import type {
  LocalScanEntry,
  MaintenanceCommitItem,
  MaintenancePresetId,
  MaintenancePreviewResult,
  MaintenanceStatus,
} from "../types";

export type MaintenanceIpcContract = {
  [IpcChannel.Maintenance_Scan]: IpcProcedure<
    { dirPath?: string; filePaths?: string[] },
    { entries: LocalScanEntry[] }
  >;
  [IpcChannel.Maintenance_Preview]: IpcProcedure<
    { entries?: LocalScanEntry[]; presetId?: MaintenancePresetId },
    MaintenancePreviewResult
  >;
  [IpcChannel.Maintenance_Execute]: IpcProcedure<
    { items?: MaintenanceCommitItem[]; presetId?: MaintenancePresetId },
    { success: true }
  >;
  [IpcChannel.Maintenance_Stop]: IpcProcedure<void, { success: true }>;
  [IpcChannel.Maintenance_Pause]: IpcProcedure<void, { success: true }>;
  [IpcChannel.Maintenance_Resume]: IpcProcedure<void, { success: true }>;
  [IpcChannel.Maintenance_GetStatus]: IpcProcedure<void, MaintenanceStatus>;
};

import { IpcChannel } from "../IpcChannel";
import type { IpcProcedure } from "../ipcTypes";
import type { MaintenanceActiveSessionSnapshot } from "../maintenanceTasks";
import type { LocalScanEntry, MaintenanceApplyCommit, MaintenancePresetId, MaintenancePreviewResult } from "../types";

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
    { items?: MaintenanceApplyCommit[]; presetId?: MaintenancePresetId },
    { success: true }
  >;
  [IpcChannel.Maintenance_Stop]: IpcProcedure<void, { success: true }>;
  [IpcChannel.Maintenance_Pause]: IpcProcedure<void, { success: true }>;
  [IpcChannel.Maintenance_Resume]: IpcProcedure<void, { success: true }>;
  [IpcChannel.Maintenance_GetActiveSession]: IpcProcedure<void, MaintenanceActiveSessionSnapshot | null>;
  [IpcChannel.Maintenance_UpdateDraft]: IpcProcedure<
    {
      previewId: string;
      fieldSelections?: Record<string, "old" | "new">;
      imageSelections?: Record<string, string>;
    },
    { success: true }
  >;
  [IpcChannel.Maintenance_DiscardSession]: IpcProcedure<void, { success: true }>;
};

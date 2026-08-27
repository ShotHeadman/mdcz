import { IpcChannel } from "../IpcChannel";
import type { IpcProcedure } from "../ipcTypes";
import type { MaintenanceActiveSessionSnapshot, MaintenanceApplySelection } from "../maintenanceTasks";
import type { LocalScanEntry, MaintenancePresetId } from "../types";

export type MaintenanceIpcContract = {
  [IpcChannel.Maintenance_Scan]: IpcProcedure<
    { dirPath?: string; filePaths?: string[] },
    { entries: LocalScanEntry[] }
  >;
  [IpcChannel.Maintenance_StartPreview]: IpcProcedure<
    { entries?: LocalScanEntry[]; presetId?: MaintenancePresetId },
    { sessionId: string }
  >;
  [IpcChannel.Maintenance_Apply]: IpcProcedure<
    { selections?: MaintenanceApplySelection[]; presetId?: MaintenancePresetId },
    { sessionId: string }
  >;
  [IpcChannel.Maintenance_Stop]: IpcProcedure<void, { success: true }>;
  [IpcChannel.Maintenance_Pause]: IpcProcedure<void, { success: true }>;
  [IpcChannel.Maintenance_Resume]: IpcProcedure<void, { success: true }>;
  [IpcChannel.Maintenance_ReadSnapshot]: IpcProcedure<void, MaintenanceActiveSessionSnapshot | null>;
  [IpcChannel.Maintenance_UpdateDraft]: IpcProcedure<
    {
      previewId: string;
      fieldSelections?: Record<string, "old" | "new">;
    },
    { success: true }
  >;
  [IpcChannel.Maintenance_DiscardSession]: IpcProcedure<void, { success: true }>;
};

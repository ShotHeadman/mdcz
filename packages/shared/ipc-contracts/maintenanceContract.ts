import { IpcChannel } from "../IpcChannel";
import type { IpcProcedure } from "../ipcTypes";
import type { MaintenanceActiveSessionSnapshot, MaintenanceApplySelection } from "../maintenanceTasks";
import type { RootFileRef } from "../mediaRef";
import type { MaintenancePresetId } from "../types";

export type MaintenanceIpcContract = {
  [IpcChannel.Maintenance_StartPreview]: IpcProcedure<
    { refs?: RootFileRef[]; presetId?: MaintenancePresetId },
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

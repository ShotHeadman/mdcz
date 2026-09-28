import type { MaintenancePresetId } from "./types";

/** Preset labels and descriptions live in the UI locale dictionaries, keyed by MaintenancePresetId. */
export interface MaintenancePresetMeta {
  id: MaintenancePresetId;
  supportsExecution: boolean;
}

export const MAINTENANCE_PRESET_META: Record<MaintenancePresetId, MaintenancePresetMeta> = {
  inspect_local: { id: "inspect_local", supportsExecution: false },
  refresh_metadata: { id: "refresh_metadata", supportsExecution: true },
  local_organize: { id: "local_organize", supportsExecution: true },
  rebuild_all: { id: "rebuild_all", supportsExecution: true },
};

export const MAINTENANCE_PRESET_OPTIONS = Object.values(MAINTENANCE_PRESET_META);

export const getMaintenancePresetMeta = (presetId: MaintenancePresetId): MaintenancePresetMeta =>
  MAINTENANCE_PRESET_META[presetId];

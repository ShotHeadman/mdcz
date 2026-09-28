import type { Configuration, DeepPartial } from "@mdcz/shared/config";
import type { MaintenancePresetId } from "@mdcz/shared/types";

export interface MaintenancePreset {
  id: MaintenancePresetId;
  requiresNetwork: boolean;
  supportsExecution: boolean;
  dataSource: "local" | "online";
  output: "none" | "write" | "move";
  assetPolicy: "preserve" | "refresh" | "replace";
  configOverrides: DeepPartial<Configuration>;
}

export const MAINTENANCE_PRESETS: Record<MaintenancePresetId, MaintenancePreset> = {
  inspect_local: {
    id: "inspect_local",
    requiresNetwork: false,
    supportsExecution: false,
    dataSource: "local",
    output: "none",
    assetPolicy: "preserve",
    configOverrides: {},
  },
  refresh_metadata: {
    id: "refresh_metadata",
    requiresNetwork: true,
    supportsExecution: true,
    dataSource: "online",
    output: "write",
    assetPolicy: "refresh",
    configOverrides: {
      download: {
        keepThumb: true,
        keepPoster: true,
        keepFanart: true,
        keepSceneImages: true,
        keepTrailer: true,
      },
      behavior: {
        successFileMove: false,
        successFileRename: false,
      },
    },
  },
  local_organize: {
    id: "local_organize",
    requiresNetwork: false,
    supportsExecution: true,
    dataSource: "local",
    output: "move",
    assetPolicy: "preserve",
    configOverrides: {
      behavior: {
        successFileMove: true,
        successFileRename: true,
      },
    },
  },
  rebuild_all: {
    id: "rebuild_all",
    requiresNetwork: true,
    supportsExecution: true,
    dataSource: "online",
    output: "move",
    assetPolicy: "replace",
    configOverrides: {
      download: {
        keepThumb: false,
        keepPoster: false,
        keepFanart: false,
        keepSceneImages: false,
        keepTrailer: false,
      },
      behavior: {
        successFileMove: true,
        successFileRename: true,
      },
    },
  },
};

export const supportsMaintenanceExecution = (preset: MaintenancePreset): boolean => preset.supportsExecution;

export const getMaintenancePreset = (id: MaintenancePresetId): MaintenancePreset => MAINTENANCE_PRESETS[id];

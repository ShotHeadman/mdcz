import type { Configuration, DeepPartial } from "@mdcz/shared/config";
import type { MaintenancePresetId } from "@mdcz/shared/types";

export interface MaintenancePreset {
  id: MaintenancePresetId;
  /** `stored` re-merges the site results kept in the database, so it never touches the network. */
  dataSource: "local" | "stored" | "online";
  output: "none" | "write" | "move";
  assetPolicy: "preserve" | "refresh" | "replace";
  configOverrides: DeepPartial<Configuration>;
}

export const MAINTENANCE_PRESETS: Record<MaintenancePresetId, MaintenancePreset> = {
  import_local: {
    id: "import_local",
    dataSource: "local",
    output: "none",
    assetPolicy: "preserve",
    configOverrides: {},
  },
  refresh_metadata: {
    id: "refresh_metadata",
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
    },
  },
  remerge: {
    id: "remerge",
    dataSource: "stored",
    output: "write",
    assetPolicy: "preserve",
    configOverrides: {},
  },
  local_organize: {
    id: "local_organize",
    dataSource: "local",
    output: "move",
    assetPolicy: "preserve",
    configOverrides: {},
  },
  rebuild_all: {
    id: "rebuild_all",
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
    },
  },
};

export const getMaintenancePreset = (id: MaintenancePresetId): MaintenancePreset => MAINTENANCE_PRESETS[id];

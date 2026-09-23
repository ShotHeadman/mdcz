import type { Configuration, DeepPartial } from "@mdcz/shared/config";
import type { MaintenancePresetId } from "@mdcz/shared/types";

export interface MaintenancePreset {
  id: MaintenancePresetId;
  label: string;
  description: string;
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
    label: "本地查看",
    description: "不联网，只读取当前目录内现有视频、NFO、图片等本地产物",
    requiresNetwork: false,
    supportsExecution: false,
    dataSource: "local",
    output: "none",
    assetPolicy: "preserve",
    configOverrides: {},
  },
  refresh_metadata: {
    id: "refresh_metadata",
    label: "原地更新",
    description: "联网重新获取元数据和资源，生成字段替换和图片替换计划",
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
    label: "本地整理",
    description: "以本地已有元数据为主，按当前模板重命名文件、目录并重排结构",
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
    label: "全量重整",
    description: "先联网刷新数据，再按当前模板完整重排目录与文件",
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

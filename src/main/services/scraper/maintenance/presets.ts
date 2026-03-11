import type { Configuration, DeepPartial } from "@main/services/config/models";
import type { MaintenancePresetId } from "@shared/types";

export interface MaintenanceSteps {
  aggregate: boolean;
  translate: boolean;
  download: boolean;
  generateNfo: boolean;
  organize: boolean;
}

export interface MaintenancePreset {
  id: MaintenancePresetId;
  label: string;
  description: string;
  requiresNetwork: boolean;
  steps: MaintenanceSteps;
  configOverrides: DeepPartial<Configuration>;
}

export const MAINTENANCE_PRESETS: Record<MaintenancePresetId, MaintenancePreset> = {
  read_local: {
    id: "read_local",
    label: "读取本地",
    description: "不联网，只读取当前目录内现有视频、NFO、图片等本地产物",
    requiresNetwork: false,
    steps: {
      aggregate: false,
      translate: false,
      download: false,
      generateNfo: false,
      organize: false,
    },
    configOverrides: {},
  },

  refresh_data: {
    id: "refresh_data",
    label: "刷新数据",
    description: "联网重新获取元数据和资源，生成字段替换和图片替换计划",
    requiresNetwork: true,
    steps: {
      aggregate: true,
      translate: true,
      download: true,
      generateNfo: true,
      organize: false,
    },
    configOverrides: {
      download: {
        keepThumb: true,
        keepPoster: true,
        keepFanart: true,
        keepSceneImages: true,
        keepTrailer: true,
        keepNfo: false,
      },
      behavior: {
        successFileMove: false,
        successFileRename: true,
      },
    },
  },

  organize_files: {
    id: "organize_files",
    label: "整理目录",
    description: "以本地已有元数据为主，按当前模板重命名文件、目录并重排结构",
    requiresNetwork: false,
    steps: {
      aggregate: false,
      translate: false,
      download: false,
      generateNfo: false,
      organize: true,
    },
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
    steps: {
      aggregate: true,
      translate: true,
      download: true,
      generateNfo: true,
      organize: true,
    },
    configOverrides: {
      download: {
        keepThumb: false,
        keepPoster: false,
        keepFanart: false,
        keepSceneImages: false,
        keepTrailer: false,
        keepNfo: false,
      },
      behavior: {
        successFileMove: true,
        successFileRename: true,
      },
    },
  },
};

export function getPreset(id: MaintenancePresetId): MaintenancePreset {
  return MAINTENANCE_PRESETS[id];
}

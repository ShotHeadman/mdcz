import type { MaintenancePresetId } from "./types";

export interface MaintenancePresetMeta {
  id: MaintenancePresetId;
  label: string;
  description: string;
  supportsExecution: boolean;
}

export const MAINTENANCE_PRESET_META: Record<MaintenancePresetId, MaintenancePresetMeta> = {
  read_local: {
    id: "read_local",
    label: "读取本地",
    description: "不联网，只读取当前目录内现有视频、NFO、图片等本地产物",
    supportsExecution: false,
  },
  refresh_data: {
    id: "refresh_data",
    label: "刷新数据",
    description: "联网重新获取元数据和资源，生成字段替换和图片替换计划",
    supportsExecution: true,
  },
  organize_files: {
    id: "organize_files",
    label: "整理目录",
    description: "以本地已有元数据为主，按当前模板重命名文件、目录并重排结构",
    supportsExecution: true,
  },
  rebuild_all: {
    id: "rebuild_all",
    label: "全量重整",
    description: "先联网刷新数据，再按当前模板完整重排目录与文件",
    supportsExecution: true,
  },
};

export const MAINTENANCE_PRESET_OPTIONS = Object.values(MAINTENANCE_PRESET_META);

export const getMaintenancePresetMeta = (presetId: MaintenancePresetId): MaintenancePresetMeta =>
  MAINTENANCE_PRESET_META[presetId];

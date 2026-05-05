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
    description: "扫描本地文件，读取现有 NFO 与资源状态",
    supportsExecution: false,
  },
  refresh_data: {
    id: "refresh_data",
    label: "刷新数据",
    description: "联网刷新元数据，对比NFO差异",
    supportsExecution: true,
  },
  organize_files: {
    id: "organize_files",
    label: "整理目录",
    description: "按规则重新组织文件目录结构",
    supportsExecution: true,
  },
  rebuild_all: {
    id: "rebuild_all",
    label: "全量重整",
    description: "重新获取数据并按现有设置修改目录结构",
    supportsExecution: true,
  },
};

export const MAINTENANCE_PRESET_OPTIONS = Object.values(MAINTENANCE_PRESET_META);

export const getMaintenancePresetMeta = (presetId: MaintenancePresetId): MaintenancePresetMeta =>
  MAINTENANCE_PRESET_META[presetId];

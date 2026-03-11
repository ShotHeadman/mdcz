import type { MaintenancePresetId } from "@shared/types";

export interface MaintenancePresetMeta {
  id: MaintenancePresetId;
  label: string;
  description: string;
  executeSummary: string[];
}

export const MAINTENANCE_PRESET_META: Record<MaintenancePresetId, MaintenancePresetMeta> = {
  read_local: {
    id: "read_local",
    label: "读取本地",
    description: "扫描本地文件，仅读取现有NFO数据",
    executeSummary: ["读取选中项目的本地视频与 NFO 信息", "整理并展示本地元数据与资源状态"],
  },
  refresh_data: {
    id: "refresh_data",
    label: "刷新数据",
    description: "联网刷新元数据，对比NFO差异",
    executeSummary: [
      "联网刷新选中项目的元数据",
      "对比现有 NFO 并展示字段差异",
      "重新生成 NFO，并按当前命名规则重命名文件",
    ],
  },
  organize_files: {
    id: "organize_files",
    label: "整理目录",
    description: "按规则重新组织文件目录结构",
    executeSummary: ["按当前命名规则重新规划目录结构", "执行视频文件整理与路径迁移"],
  },
  rebuild_all: {
    id: "rebuild_all",
    label: "全量重整",
    description: "重新获取数据并按现有设置修改目录结构",
    executeSummary: ["联网刷新选中项目的元数据", "重建 NFO 与资源文件", "按当前规则执行目录整理"],
  },
};

export const MAINTENANCE_PRESET_OPTIONS = Object.values(MAINTENANCE_PRESET_META);

export const getMaintenancePresetMeta = (presetId: MaintenancePresetId): MaintenancePresetMeta =>
  MAINTENANCE_PRESET_META[presetId];

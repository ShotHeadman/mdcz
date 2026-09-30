import type { Messages } from "../en";

export const library: Messages["library"] = {
  filter: {
    all: "全部",
    available: "可用",
    unavailable: "不可用",
    partial: "部分可用",
    unchecked: "未检查",
  },
  metrics: {
    movies: "影片数",
    files: "文件数",
    available: "可用",
    unavailable: "不可用",
    checking: "检查中",
    unchecked: "未检查",
    totalSize: "总大小",
  },
  searchAriaLabel: "搜索媒体库",
  searchPlaceholder: "搜索标题、番号、演员或相对路径...",
  refresh: "刷新",
  listAriaLabel: "媒体库影片列表",
  checkingAvailability: "正在检查可用性",
  noConfirmedEntries: (unknownCount: number) => `暂无已确认条目，另有 ${unknownCount} 条尚未检查`,
  noMatchingEntries: "暂无匹配条目",
  loadMore: "加载更多",

  // Entry card
  parts: (count: number) => `${count} 个分盘`,
  partsMissing: (missing: number, total: number) => `${total} 个分盘缺失 ${missing} 个`,
  fileActions: "文件操作",
  size: "大小",
  updatedTime: "更新时间",
  scrapeInfo: "刮削信息",
  openFolder: "打开所在目录",
  removeFromLibrary: "从媒体库移除",
  availabilityNotChecked: "可用性尚未检查",

  // Availability labels
  availability: {
    partial: "部分可用",
    unavailable: "全部不可用",
  },

  // Delete dialog
  removeDialogTitle: "从媒体库移除",
  removeDialogDescription: (fileCount: number, assetCount: number) =>
    `将移除 ${fileCount} 个视频文件记录和 ${assetCount} 个资源记录。`,
  removing: "正在移除...",
  confirmRemove: "确认移除",

  // File rows
  fileStatus: {
    available: "可用",
    unavailable: "不可用",
    unchecked: "未检查",
  },
  copyPath: "复制路径",
  openLocation: "打开位置",
  relink: "重新关联",
  removeFile: "从媒体库移除",

  // Relink / remove file dialog
  relinkFileTitle: "重新关联文件",
  removeFileDescription: "将从媒体库移除该文件记录，其他分盘文件仍会保留。",
  mediaFolderLabel: (name: string) => `所在媒体目录：${name}`,
  newRelativePath: "新相对路径",
  confirm: "确认",
};

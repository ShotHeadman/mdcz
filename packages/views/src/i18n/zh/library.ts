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
  allLibraries: "全部媒体库",
  libraryAriaLabel: "媒体库",
  view: { list: "列表", wall: "海报墙" },
  health: {
    title: "健康状况",
    issues: {
      missingPoster: "缺少海报",
      missingBackdrop: "缺少背景图",
      missingSynopsis: "缺少简介",
      noNfo: "没有 NFO",
      duplicate: "编号重复",
    },
    fix: (count: number) => `从站点刷新 ${count} 部`,
    fixHint: "打开刷新结果的预览，应用之前不会写入任何内容。",
    fixStarted: (count: number) => `正在预览 ${count} 部影片的刷新`,
    mixedRoots: "这些影片分布在多个媒体目录，请先选定一个媒体库再修复。",
    clear: "清除筛选",
  },
  facets: {
    title: "按条件浏览",
    actors: "演员",
    studios: "片商",
    tags: "标签",
    none: "暂无可浏览的内容",
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

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
      duplicate: "番号重复",
    },
    fix: (count: number) => `从站点刷新 ${count} 部`,
    fixHint: "打开刷新结果的预览，应用之前不会写入任何内容。",
    ignored: "已忽略",
    ignore: (count: number) => `忽略这 ${count} 部`,
    ignoreHint: "忽略后不再计入健康状况，可在“已忽略”中恢复。",
    restore: (count: number) => `取消忽略 ${count} 部`,
    fixStarted: (count: number) => `正在预览 ${count} 部影片的刷新`,
    mixedRoots: "所选影片位于不同媒体目录，批量刷新仅支持同一目录。请筛选后重试。",
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
  nothingIndexed: "还没有收录影片。刮削或导入的影片会显示在这里。",
  loadMore: "加载更多",

  // Entry card
  parts: (count: number) => `${count} 个分盘`,
  partsMissing: (missing: number, total: number) => `${total} 个分盘缺失 ${missing} 个`,
  fileActions: "文件操作",
  scrapeInfo: "刮削信息",
  openFolder: "打开所在目录",
  removeFromLibrary: "从媒体库移除",
  multiSelect: "多选",
  selectEntry: (id: string) => `选择 ${id}`,
  selectAllLoaded: "全选已加载",
  selectedCount: (count: number) => `已选 ${count} 部影片`,
  availabilityNotChecked: "可用性尚未检查",

  // Availability labels
  availability: {
    partial: "部分可用",
    unavailable: "全部不可用",
  },

  // Delete dialog
  removeDialogTitle: "从媒体库移除",
  removeDialogDescription: (movieCount: number, fileCount: number, assetCount: number) =>
    `将移除 ${movieCount} 部影片的 ${fileCount} 个视频文件记录和 ${assetCount} 个资源记录，磁盘上的文件不会被删除。`,
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

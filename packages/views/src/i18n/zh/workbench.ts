import type { Messages } from "../en";

export const workbench: Messages["workbench"] = {
  taskConflict: {
    scrape: "刮削任务正在运行中，无法同时执行维护或修复。请等待刮削完成或先停止当前任务。",
    maintenance: "维护任务正在运行中，无法启动新的刮削。请等待维护完成或先停止任务。",
  },

  // Return button
  returnDialogDescription: "返回后会清空当前工作台内容，确定继续吗？",
  returnDialogTitle: "返回工作台初始页面",
  confirmReturn: "确认返回",

  // Frame actions
  analyzingFiles: "正在分析文件...",
  runSummary: (succeeded: number, failed: number, skipped: number, duration: string | null) =>
    [`成功 ${succeeded}`, `失败 ${failed}`, `跳过 ${skipped}`, duration ?? ""].filter(Boolean).join(" · "),
  resumeScrape: "恢复刮削任务",
  pauseScrape: "暂停刮削任务",
  resume: "恢复",
  pause: "暂停",
  stopScrape: "停止刮削任务",
  stop: "停止",
  scrapeReturnDescription: "返回后会清空当前刮削结果并回到工作台初始页面。确定继续吗？",
  rescrapeDirectory: "重新刮削此目录",
  taskStateVideos: "视频",
  taskStateSkipped: "跳过",
  taskStateInLibrary: "已在库中",
  taskStateInaccessiblePaths: "部分路径无法访问",
  retryFailed: "重试失败",
  actorSyncQueued: (servers: string) => `${servers} · 人物同步排队中`,
  actorSyncWaiting: (servers: string, found: number, total: number) =>
    `${servers} · 等待媒体服务器识别（人物 ${found}/${total}）`,
  actorSyncSyncing: (servers: string, done: number, total: number) => `${servers} · 正在同步人物 ${done}/${total}`,
  actorSyncSummary: (synced: number, notFound: number, failed: number) =>
    [`人物同步完成：已更新 ${synced}`, notFound ? `未识别 ${notFound}` : "", failed ? `失败 ${failed}` : ""]
      .filter(Boolean)
      .join(" · "),
  actorSyncCancelled: "人物同步已取消",
  actorSyncScanMissed: (servers: string) =>
    `${servers} 未能及时识别到新人物。请检查该服务器中的媒体库路径是否与 MDCz 一致。`,
  cancelActorSync: "取消",

  // Setup view
  browse: "浏览",
  scanningStatus: (scope: string, seconds: number) => `正在扫描（${scope}）· 已耗时 ${seconds} 秒`,
  scopeRecursive: "含子目录",
  scopeCurrentOnly: "仅当前目录",
  selectedFilesSummary: (count: number, size: string) => `已选 ${count} 个文件 · ${size}`,
  startWholeDirectoryTitle: "处理目录内全部视频？",
  startWholeDirectoryDescription: (scanDir: string, scope: string) =>
    `尚未预览文件，将处理 ${scanDir} 内的全部视频（${scope}）。如需挑选文件，请先点击“预览文件”。`,
  backToConfig: "返回配置",
  previewFiles: "预览文件",
  startScrape: "开始刮削",
  startMaintenance: "开始维护",
  stepsNavAriaLabel: "工作台步骤",
  step01: "01 配置目录",
  step02: "02 预览文件",
  optional: "可选",
  scanDirLabel: "扫描目录",
  includeSubdirs: "包含子目录",
  scanDirPlaceholder: "请选择需要扫描的媒体目录",
  loadingConfig: "正在读取配置...",
  libraryLabel: "媒体库",
  libraryPlaceholder: "请选择媒体库",
  manageLibraries: "管理媒体库",
  noLibraries: "请先创建媒体库以配置文件输出目录与归档规则。",
  createLibrary: "创建媒体库",
  inaccessiblePathsWarning: (count: number) => `部分路径无法访问，已跳过 ${count} 项`,
  selectVisibleFilesAriaLabel: "选择当前可见文件",
  refreshFiles: "刷新文件",
  alreadyInLibrary: "已在库中",
  selectedOfTotalFiles: (selected: number, total: number) => `已选 ${selected} / ${total} 个文件`,
  searchFilesAriaLabel: "搜索文件",
  searchFilesPlaceholder: "搜索文件...",
  clearSearchAriaLabel: "清空搜索",
  totalSize: (size: string) => `总大小 ${size}`,
  showingItems: (count: number) => `显示 ${count} 项`,
  colFile: "文件",
  colType: "类型",
  colSize: "大小",
  scanFailed: "扫描失败",
  previewHint: "选择目录后，点击“预览文件”查看可处理的媒体文件。",
  noVideosFoundRecursive: "未找到支持的视频",
  noVideosFoundCurrent: "当前目录未找到视频，可勾选“包含子目录”",
  supportedTypes: (types: string) => `支持类型: ${types}`,
  noFilesMatching: (query: string) => `未找到匹配“${query}”的文件`,
  clearSearch: "清空搜索",

  // Setup adapter
  cancelScanFailed: (error: string) => `取消扫描失败: ${error}`,
  selectScanDirFailed: (error: string) => `选择扫描目录失败: ${error}`,
  enterFullPath: "请输入完整路径",

  // Ports
};

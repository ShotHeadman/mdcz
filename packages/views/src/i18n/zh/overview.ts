import type { Messages } from "../en";

export const overview: Messages["overview"] = {
  hero: {
    startAction: "去工作台",
    setupAction: "去设置",
    title: "开始刮削",
    description: "进入工作台执行元数据提取。当前输出目录概况会在完成刮削后保持更新。",
    loadFailed: "加载失败",
    waitingFirstScrape: "等待首次刮削",
    notConfigured: "未配置",
    files: "文件数",
    size: "大小",
  },
  activity: {
    title: "最近活动",
    kinds: { scan: "扫描", scrape: "刮削", maintenance: "维护" },
    statuses: {
      queued: "排队中",
      discovering: "正在查找视频",
      running: "运行中",
      paused: "已暂停",
      stopping: "正在停止",
      completed: "已完成",
      failed: "失败",
      stopped: "已停止",
      interrupted: "已中断",
    },
    counts: (succeeded: number, failed: number, skipped: number) =>
      [`成功 ${succeeded}`, failed ? `失败 ${failed}` : "", skipped ? `跳过 ${skipped}` : ""]
        .filter(Boolean)
        .join("，"),
  },
  maintenance: {
    title: "维护",
    description: "预览目录变更、修复元数据并处理批量重写，让输出目录保持干净一致。",
    action: "去工作台",
  },
  recent: {
    removeDialogTitle: "从最近入库移除",
    loadFailedTitle: "最近入库加载失败",
    loadFailedDescription: "请稍后重试，或检查应用日志。",
    emptyTitle: "暂无刮削记录",
    emptyDescription: "完成一次刮削后，最近入库的影片会出现在这里。",
    unknownActor: "未知演员",
    retry: "重试",
    confirm: "确认",
    removeAriaLabel: (title: string) => `从最近入库移除 ${title}`,
    openFolderAriaLabel: (title: string) => `打开 ${title} 所在目录`,
  },
};

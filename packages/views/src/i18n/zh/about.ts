import type { Messages } from "../en";

export const about: Messages["about"] = {
  feedback: "提交反馈",
  communityAndFeedback: "社区与反馈",
  autoCheckUpdates: "自动检查更新",
  debugAction: "开启调试",
  loading: "读取信息中",
  updateCheckNow: "立即检查",
  updateChecking: "正在检查更新…",
  updateLatest: "已是最新版本",
  updateAvailable: (version: string) => `发现新版本 MDCz v${version}`,
  updateDownload: "下载更新",
  updateOpenDownload: "前往 GitHub 下载",
  updateDownloading: (version: string, percent: number) => `正在下载 v${version}… ${percent}%`,
  updateDownloaded: (version: string) => `v${version} 已下载，重启或退出 MDCz 时自动安装`,
  updateInstall: "立即重启",
  updateFailed: (error: string) => `更新失败: ${error}`,
  relatedProjectsTitle: "相关项目",
  relatedProjects: {
    mdcx: "原 Python 版本项目",
    movieDataCapture: "命令行版核心项目",
  },
};

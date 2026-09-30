import type { Messages } from "../en";

export const detail: Messages["detail"] = {
  // Result tree
  processingQueue: "处理队列",
  noResults: "暂无结果",
  rescrapeByUrl: "按 URL 重新刮削",
  currentStatus: (number: string, status: string) => `当前番号：${number} · 状态：${status}`,
  submitting: "提交中...",
  rescrape: "重新刮削",

  // Scene image gallery
  preview: "预览",
  galleryTitle: "剧照预览",
  galleryDescription: (current: number, total: number) =>
    `查看剧照大图预览，当前第 ${current} 张，共 ${total} 张，可使用左右方向键切换。`,
  closePreview: "关闭剧照预览",
  previousPhoto: "上一张剧照",
  nextPhoto: "下一张剧照",

  // Poster crop dialog
  editCover: "编辑封面",
  cropDescription: "拖动选区调整位置，使用缩放控制取景范围。",
  cropSourceAlt: "封面裁剪源图",
  cropRegionAriaLabel: "封面裁剪区域",
  zoom: "缩放",
  zoomAriaLabel: "封面缩放",
  cropPreviewAlt: "封面裁剪预览",
  outputRatioAndSize: (width: number, height: number) => `输出比例 2:3 · ${width} x ${height}`,
  reset: "重置",
  saving: "保存中...",
  saveCover: "保存封面",

  // Detail panel view
  errorDetails: "错误详情",
  play: "播放",
  openSourceFolder: "打开源目录",
  openMetadataFolder: "打开元数据目录",
  editNfo: "编辑 NFO",
  selectItemPrompt: "请选择一个项目以查看详情",
  dataCompare: "数据对比",
  filePath: "文件路径",
  fields: {
    actors: "演员",
    studio: "制片",
    releaseDate: "发行日期",
    series: "系列",
    director: "导演",
    genres: "标签",
    resolution: "分辨率",
    bitrate: "码率",
    duration: "时长",
    publisher: "发行商",
  },
  sections: {
    details: "详情",
    plot: "内容简介",
    poster: "缩略图",
    stills: "剧照",
    trailer: "预告片",
  },
  posterThumbAlt: (alt: string) => `${alt} 缩略图`,
  posterPreviewTitle: "缩略图预览",
  posterPreviewDescription: "查看当前缩略图的大图预览。",
  closePosterPreview: "关闭缩略图预览",
  posterPreviewAlt: (alt: string) => `${alt} 缩略图大图预览`,
};

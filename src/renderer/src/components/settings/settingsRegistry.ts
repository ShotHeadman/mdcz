/**
 * Pure data + utilities for the settings editor. Extracted from
 * `settingsContent.tsx` so hooks and filter logic can reuse the same metadata
 * without pulling in React renderers.
 */

export const SECTION_ORDER = ["dataSources", "rateLimiting", "extractionRules", "paths", "system"] as const;

export type FieldAnchor = (typeof SECTION_ORDER)[number];
export type FieldSurface = "settings" | "about" | "internal";
export type FieldVisibility = "public" | "advanced" | "hidden";

export interface FieldEntry {
  key: string;
  label: string;
  anchor: FieldAnchor;
  surface: FieldSurface;
  visibility: FieldVisibility;
  aliases: string[];
  description?: string;
}

export interface AggregationPriorityFieldDefinition {
  key: `aggregation.fieldPriorities.${string}`;
  label: string;
  description: string;
  aliases: string[];
}

export const SECTION_DESCRIPTIONS: Record<FieldAnchor, string> = {
  dataSources: "刮削站点、翻译、人物同步服务的数据来源与凭证",
  rateLimiting: "并发、延迟、重试、代理等节奏与连接控制",
  extractionRules: "抓取策略、命名模板、资源下载与 NFO",
  paths: "媒体库、头像库、输出与配置目录",
  system: "界面、快捷键、刮削后的文件行为",
};

export const SECTION_LABELS: Record<FieldAnchor, string> = {
  dataSources: "数据源",
  rateLimiting: "速率与限流",
  extractionRules: "提取规则",
  paths: "目录与路径",
  system: "系统",
};

export const SECTION_FILTER_ALIASES: Record<FieldAnchor, string[]> = {
  dataSources: ["data", "source", "sources", "provider", "translation", "sync"],
  rateLimiting: ["rate", "limit", "network", "proxy", "retry", "timeout"],
  extractionRules: ["download", "nfo", "naming", "rule", "rules", "asset"],
  paths: ["path", "paths", "folder", "directory", "directories"],
  system: ["system", "ui", "shortcut", "behavior"],
};

export const AGGREGATION_PRIORITY_FIELDS: AggregationPriorityFieldDefinition[] = [
  {
    key: "aggregation.fieldPriorities.title",
    label: "标题来源顺序",
    description: "按站点顺序选择影片标题。",
    aliases: ["aggregation", "priority", "title", "标题", "字段来源"],
  },
  {
    key: "aggregation.fieldPriorities.plot",
    label: "简介来源顺序",
    description: "按站点顺序选择影片简介。",
    aliases: ["aggregation", "priority", "plot", "summary", "简介", "剧情"],
  },
  {
    key: "aggregation.fieldPriorities.actors",
    label: "演员来源顺序",
    description: "按站点顺序选择演员列表。",
    aliases: ["aggregation", "priority", "actors", "cast", "演员"],
  },
  {
    key: "aggregation.fieldPriorities.genres",
    label: "类型来源顺序",
    description: "按站点顺序选择类型与标签。",
    aliases: ["aggregation", "priority", "genres", "tags", "类型", "标签"],
  },
  {
    key: "aggregation.fieldPriorities.thumb_url",
    label: "缩略图来源顺序",
    description: "按站点顺序选择横版缩略图。",
    aliases: ["aggregation", "priority", "thumb", "thumbnail", "缩略图"],
  },
  {
    key: "aggregation.fieldPriorities.poster_url",
    label: "海报来源顺序",
    description: "按站点顺序选择海报。",
    aliases: ["aggregation", "priority", "poster", "cover", "海报"],
  },
  {
    key: "aggregation.fieldPriorities.scene_images",
    label: "剧照来源顺序",
    description: "按站点顺序选择剧照集合。",
    aliases: ["aggregation", "priority", "scene images", "extrafanart", "剧照"],
  },
  {
    key: "aggregation.fieldPriorities.studio",
    label: "片商来源顺序",
    description: "按站点顺序选择片商信息。",
    aliases: ["aggregation", "priority", "studio", "maker", "片商"],
  },
  {
    key: "aggregation.fieldPriorities.director",
    label: "导演来源顺序",
    description: "按站点顺序选择导演信息。",
    aliases: ["aggregation", "priority", "director", "导演"],
  },
  {
    key: "aggregation.fieldPriorities.publisher",
    label: "发行商来源顺序",
    description: "按站点顺序选择发行商信息。",
    aliases: ["aggregation", "priority", "publisher", "label", "发行商"],
  },
  {
    key: "aggregation.fieldPriorities.series",
    label: "系列来源顺序",
    description: "按站点顺序选择系列信息。",
    aliases: ["aggregation", "priority", "series", "系列"],
  },
  {
    key: "aggregation.fieldPriorities.release_date",
    label: "发行日期来源顺序",
    description: "按站点顺序选择发行日期。",
    aliases: ["aggregation", "priority", "release date", "date", "发行日期"],
  },
  {
    key: "aggregation.fieldPriorities.durationSeconds",
    label: "时长来源顺序",
    description: "按站点顺序选择影片时长。",
    aliases: ["aggregation", "priority", "duration", "runtime", "时长"],
  },
  {
    key: "aggregation.fieldPriorities.rating",
    label: "评分来源顺序",
    description: "按站点顺序选择评分。",
    aliases: ["aggregation", "priority", "rating", "score", "评分"],
  },
  {
    key: "aggregation.fieldPriorities.trailer_url",
    label: "预告片来源顺序",
    description: "按站点顺序选择预告片地址。",
    aliases: ["aggregation", "priority", "trailer", "preview", "预告片"],
  },
];

const AGGREGATION_PRIORITY_ALIASES = Object.fromEntries(
  AGGREGATION_PRIORITY_FIELDS.map((entry) => [entry.key, entry.aliases]),
) as Record<string, string[]>;

const ADVANCED_FIELD_KEYS = new Set<string>([
  "download.sceneImageConcurrency",
  "aggregation.maxParallelCrawlers",
  "aggregation.perCrawlerTimeoutMs",
  "aggregation.globalTimeoutMs",
  "aggregation.behavior.preferLongerPlot",
  "aggregation.behavior.maxSceneImages",
  "aggregation.behavior.maxActors",
  "aggregation.behavior.maxGenres",
  ...AGGREGATION_PRIORITY_FIELDS.map((entry) => entry.key),
]);

const FIELD_ALIASES: Record<string, string[]> = {
  ...AGGREGATION_PRIORITY_ALIASES,
  "paths.mediaPath": ["media", "library", "媒体库"],
  "paths.actorPhotoFolder": ["actor", "photo", "头像", "演员"],
  "paths.softlinkPath": ["symlink", "softlink", "链接"],
  "paths.successOutputFolder": ["output", "success", "成功目录"],
  "paths.failedOutputFolder": ["output", "failed", "失败目录"],
  "paths.outputSummaryPath": ["summary", "overview", "概览目录"],
  "paths.configDirectory": ["config", "profile", "配置目录"],
  "scrape.sites": ["site", "sites", "priority", "source priority", "站点优先级"],
  "network.javdbCookie": ["cookie", "javdb", "凭证"],
  "network.javbusCookie": ["cookie", "javbus", "凭证"],
  "translate.engine": ["translator", "translation", "翻译引擎"],
  "translate.llmModelName": ["model", "openai", "llm"],
  "translate.llmApiKey": ["api key", "token", "openai key", "密钥"],
  "translate.llmBaseUrl": ["base url", "endpoint", "api 地址"],
  "translate.llmPrompt": ["prompt", "提示词"],
  "translate.targetLanguage": ["language", "locale", "语言"],
  "naming.folderTemplate": ["template", "folder naming", "命名模板"],
  "naming.fileTemplate": ["template", "file naming", "命名模板"],
  "download.generateNfo": ["nfo", "metadata file"],
  "download.nfoNaming": ["nfo", "naming", "metadata file"],
  "download.sceneImageConcurrency": ["scene images", "download concurrency", "parallel", "剧照并发"],
  "jellyfin.url": ["media server", "jellyfin", "server"],
  "emby.url": ["media server", "emby", "server"],
  "ui.showLogsPanel": ["logs", "log panel"],
  "ui.useCustomTitleBar": ["title bar", "window chrome"],
  "shortcuts.startOrStopScrape": ["hotkey", "shortcut", "快捷键"],
  "aggregation.maxParallelCrawlers": ["aggregation", "parallel crawler", "并行站点", "聚合并发"],
  "aggregation.perCrawlerTimeoutMs": ["aggregation", "timeout", "single crawler timeout", "单站超时"],
  "aggregation.globalTimeoutMs": ["aggregation", "timeout", "global timeout", "全局超时"],
  "aggregation.behavior.preferLongerPlot": ["aggregation", "plot", "prefer longer", "长简介"],
  "aggregation.behavior.maxSceneImages": ["aggregation", "scene images", "max", "最多剧照"],
  "aggregation.behavior.maxActors": ["aggregation", "actors", "max", "最多演员"],
  "aggregation.behavior.maxGenres": ["aggregation", "genres", "tags", "最多标签"],
};

const RAW_FIELD_REGISTRY: Array<Pick<FieldEntry, "key" | "label" | "anchor" | "description">> = [
  { key: "paths.mediaPath", label: "媒体目录", anchor: "paths" },
  { key: "paths.actorPhotoFolder", label: "演员头像库目录", anchor: "paths" },
  { key: "paths.softlinkPath", label: "软链接目录", anchor: "paths" },
  { key: "paths.successOutputFolder", label: "成功输出目录", anchor: "paths" },
  { key: "paths.failedOutputFolder", label: "失败输出目录", anchor: "paths" },
  { key: "paths.outputSummaryPath", label: "概览统计目录", anchor: "paths" },
  { key: "paths.sceneImagesFolder", label: "剧照目录名", anchor: "paths" },
  { key: "paths.configDirectory", label: "配置文件目录", anchor: "paths" },
  { key: "scrape.sites", label: "启用站点与优先级", anchor: "dataSources" },
  { key: "scrape.threadNumber", label: "并发线程数", anchor: "rateLimiting" },
  { key: "scrape.javdbDelaySeconds", label: "JavDB 请求延迟(秒)", anchor: "rateLimiting" },
  { key: "scrape.restAfterCount", label: "连续刮削后休息(条数)", anchor: "rateLimiting" },
  { key: "scrape.restDuration", label: "休息时长", anchor: "rateLimiting" },
  { key: "network.proxyType", label: "代理类型", anchor: "rateLimiting" },
  { key: "network.proxy", label: "代理地址", anchor: "rateLimiting" },
  { key: "network.useProxy", label: "启用代理", anchor: "rateLimiting" },
  { key: "network.timeout", label: "超时时间(秒)", anchor: "rateLimiting" },
  { key: "network.retryCount", label: "重试次数", anchor: "rateLimiting" },
  { key: "network.javdbCookie", label: "JavDB 凭证", anchor: "dataSources" },
  { key: "network.javbusCookie", label: "JavBus 凭证", anchor: "dataSources" },
  ...AGGREGATION_PRIORITY_FIELDS.map((entry) => ({
    key: entry.key,
    label: entry.label,
    anchor: "dataSources" as const,
    description: entry.description,
  })),
  {
    key: "aggregation.maxParallelCrawlers",
    label: "聚合并行站点数",
    anchor: "rateLimiting",
    description: "同一影片聚合抓取时，最多同时请求多少个站点。",
  },
  {
    key: "aggregation.perCrawlerTimeoutMs",
    label: "单站超时 (ms)",
    anchor: "rateLimiting",
    description: "单个站点抓取在聚合阶段的最大等待时间。",
  },
  {
    key: "aggregation.globalTimeoutMs",
    label: "全局超时 (ms)",
    anchor: "rateLimiting",
    description: "单部影片整次聚合抓取允许的总超时时间。",
  },
  { key: "download.downloadThumb", label: "下载横版缩略图", anchor: "extractionRules" },
  { key: "download.downloadPoster", label: "下载海报", anchor: "extractionRules" },
  { key: "download.tagBadges", label: "封面标签角标", anchor: "extractionRules" },
  { key: "download.downloadFanart", label: "下载背景图", anchor: "extractionRules" },
  { key: "download.downloadSceneImages", label: "下载剧照", anchor: "extractionRules" },
  { key: "download.downloadTrailer", label: "下载预告片", anchor: "extractionRules" },
  {
    key: "download.sceneImageConcurrency",
    label: "剧照下载并发",
    anchor: "extractionRules",
    description: "下载剧照时允许的并发请求数。",
  },
  { key: "download.generateNfo", label: "生成 NFO", anchor: "extractionRules" },
  { key: "download.nfoNaming", label: "NFO 文件命名", anchor: "extractionRules" },
  { key: "download.keepThumb", label: "保留已有横版缩略图", anchor: "extractionRules" },
  { key: "download.keepPoster", label: "保留已有海报", anchor: "extractionRules" },
  { key: "download.keepFanart", label: "保留已有背景图", anchor: "extractionRules" },
  { key: "download.keepSceneImages", label: "保留已有剧照", anchor: "extractionRules" },
  { key: "download.keepTrailer", label: "保留已有预告片", anchor: "extractionRules" },
  { key: "download.keepNfo", label: "保留已有 NFO", anchor: "extractionRules" },
  { key: "naming.folderTemplate", label: "文件夹模板", anchor: "extractionRules" },
  { key: "naming.fileTemplate", label: "文件名模板", anchor: "extractionRules" },
  { key: "naming.assetNamingMode", label: "附属文件命名", anchor: "extractionRules" },
  { key: "naming.nfoTitleTemplate", label: "NFO 标题模板", anchor: "extractionRules" },
  { key: "naming.actorNameMax", label: "演员名最大数量", anchor: "extractionRules" },
  { key: "naming.actorNameMore", label: "演员名超出后缀", anchor: "extractionRules" },
  { key: "naming.actorFallbackToStudio", label: "演员为空时使用片商或卖家", anchor: "extractionRules" },
  { key: "naming.releaseRule", label: "发行日期格式", anchor: "extractionRules" },
  { key: "naming.folderNameMax", label: "文件夹名最大长度", anchor: "extractionRules" },
  { key: "naming.fileNameMax", label: "文件名最大长度", anchor: "extractionRules" },
  { key: "naming.cnwordStyle", label: "中文字幕标记", anchor: "extractionRules" },
  { key: "naming.umrStyle", label: "UMR 标记", anchor: "extractionRules" },
  { key: "naming.leakStyle", label: "流出标记", anchor: "extractionRules" },
  { key: "naming.uncensoredStyle", label: "无码标记", anchor: "extractionRules" },
  { key: "naming.censoredStyle", label: "有码标记", anchor: "extractionRules" },
  { key: "naming.partStyle", label: "分盘样式", anchor: "extractionRules" },
  {
    key: "aggregation.behavior.preferLongerPlot",
    label: "简介优先取更长内容",
    anchor: "extractionRules",
    description: "多站点都提供简介时，优先选择更完整、更长的版本。",
  },
  {
    key: "aggregation.behavior.maxSceneImages",
    label: "最多保留剧照数",
    anchor: "extractionRules",
    description: "聚合后最多保留多少张剧照。",
  },
  {
    key: "aggregation.behavior.maxActors",
    label: "最多保留演员数",
    anchor: "extractionRules",
    description: "聚合后最多保留多少位演员。",
  },
  {
    key: "aggregation.behavior.maxGenres",
    label: "最多保留标签数",
    anchor: "extractionRules",
    description: "聚合后最多保留多少个类型或标签。",
  },
  { key: "translate.enableTranslation", label: "启用内容翻译", anchor: "dataSources" },
  { key: "translate.engine", label: "翻译引擎", anchor: "dataSources" },
  { key: "translate.llmModelName", label: "LLM 模型名称", anchor: "dataSources" },
  { key: "translate.llmApiKey", label: "LLM 密钥", anchor: "dataSources" },
  { key: "translate.llmBaseUrl", label: "LLM API 地址", anchor: "dataSources" },
  { key: "translate.llmPrompt", label: "LLM 翻译提示词", anchor: "dataSources" },
  { key: "translate.llmTemperature", label: "LLM 温度", anchor: "dataSources" },
  { key: "translate.llmMaxRetries", label: "LLM 最大重试次数", anchor: "dataSources" },
  { key: "translate.llmMaxRequestsPerSecond", label: "LLM 每秒最大请求数", anchor: "dataSources" },
  { key: "translate.targetLanguage", label: "目标语言", anchor: "dataSources" },
  { key: "personSync.personOverviewSources", label: "人物简介来源顺序", anchor: "dataSources" },
  { key: "personSync.personImageSources", label: "人物头像来源顺序", anchor: "dataSources" },
  { key: "jellyfin.url", label: "Jellyfin 服务器地址", anchor: "dataSources" },
  { key: "jellyfin.apiKey", label: "Jellyfin API Key", anchor: "dataSources" },
  { key: "jellyfin.userId", label: "Jellyfin 用户 ID", anchor: "dataSources" },
  { key: "jellyfin.refreshPersonAfterSync", label: "同步后刷新人物 (Jellyfin)", anchor: "dataSources" },
  { key: "jellyfin.lockOverviewAfterSync", label: "同步后锁定人物简介 (Jellyfin)", anchor: "dataSources" },
  { key: "emby.url", label: "Emby 服务器地址", anchor: "dataSources" },
  { key: "emby.apiKey", label: "Emby API Key", anchor: "dataSources" },
  { key: "emby.userId", label: "Emby 用户 ID", anchor: "dataSources" },
  { key: "emby.refreshPersonAfterSync", label: "同步后刷新人物 (Emby)", anchor: "dataSources" },
  { key: "shortcuts.startOrStopScrape", label: "开始/停止刮削", anchor: "system" },
  { key: "shortcuts.retryScrape", label: "重新刮削", anchor: "system" },
  { key: "shortcuts.deleteFile", label: "删除文件", anchor: "system" },
  { key: "shortcuts.deleteFileAndFolder", label: "删除文件及文件夹", anchor: "system" },
  { key: "shortcuts.openFolder", label: "打开所在目录", anchor: "system" },
  { key: "shortcuts.editNfo", label: "编辑 NFO", anchor: "system" },
  { key: "shortcuts.playVideo", label: "播放视频", anchor: "system" },
  { key: "ui.showLogsPanel", label: "显示日志面板", anchor: "system" },
  { key: "ui.useCustomTitleBar", label: "使用自定义标题栏", anchor: "system" },
  { key: "ui.hideDock", label: "隐藏 Dock 图标", anchor: "system" },
  { key: "ui.hideMenu", label: "隐藏菜单栏", anchor: "system" },
  { key: "ui.hideWindowButtons", label: "隐藏窗口按钮", anchor: "system" },
  { key: "behavior.successFileMove", label: "成功后移动文件", anchor: "system" },
  { key: "behavior.failedFileMove", label: "失败后移动文件", anchor: "system" },
  { key: "behavior.successFileRename", label: "成功后重命名文件", anchor: "system" },
  { key: "behavior.deleteEmptyFolder", label: "删除空文件夹", anchor: "system" },
  { key: "behavior.scrapeSoftlinkPath", label: "刮削软链接目录", anchor: "system" },
  { key: "behavior.saveLog", label: "保存日志到文件", anchor: "system" },
];

export const FIELD_REGISTRY: FieldEntry[] = RAW_FIELD_REGISTRY.map((entry) => ({
  ...entry,
  surface: "settings",
  visibility: ADVANCED_FIELD_KEYS.has(entry.key) ? "advanced" : "public",
  aliases: FIELD_ALIASES[entry.key] ?? [],
}));

export const FIELD_KEYS = FIELD_REGISTRY.map((entry) => entry.key);

export const FIELD_REGISTRY_BY_KEY = Object.fromEntries(FIELD_REGISTRY.map((entry) => [entry.key, entry])) as Record<
  string,
  FieldEntry
>;

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cursor: unknown = obj;
  for (const part of parts) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor: Record<string, unknown> = obj;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== "object") cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  const tail = parts.at(-1);
  if (tail) cursor[tail] = value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function flattenConfig(data: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const entry of FIELD_REGISTRY) {
    flat[entry.key] = getNestedValue(data, entry.key);
  }

  const siteConfigs = getNestedValue(data, "scrape.siteConfigs");
  if (isRecord(siteConfigs)) {
    for (const [site, config] of Object.entries(siteConfigs)) {
      if (!isRecord(config)) {
        continue;
      }
      if ("customUrl" in config) {
        flat[`scrape.siteConfigs.${site}.customUrl`] = config.customUrl;
      }
    }
  }

  return flat;
}

export function unflattenConfig(flat: Record<string, unknown>): Record<string, unknown> {
  const nested: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    if (value !== undefined) setNestedValue(nested, key, value);
  }
  return nested;
}

export { getNestedValue, isRecord };

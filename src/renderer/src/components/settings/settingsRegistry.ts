/**
 * Pure data + utilities for the settings editor. Extracted from
 * `settingsContent.tsx` so hooks and filter logic can reuse the same metadata
 * without pulling in React renderers.
 */
import { Website } from "@shared/enums";

export const SECTION_ORDER = [
  "paths",
  "scrape",
  "network",
  "translate",
  "naming",
  "download",
  "fileBehavior",
  "system",
] as const;

export type FieldAnchor = (typeof SECTION_ORDER)[number];
export type FieldSurface = "settings" | "tools" | "about" | "internal";
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

interface SiteCustomUrlFieldDefinition {
  key: `scrape.siteConfigs.${string}.customUrl`;
  site: Website;
  label: string;
  anchor: "scrape";
  surface: "internal";
  description: string;
  aliases: string[];
}

export const SECTION_LABELS: Record<FieldAnchor, string> = {
  paths: "目录与路径",
  scrape: "刮削设置",
  network: "网络连接",
  translate: "翻译服务",
  naming: "命名规则",
  download: "下载选项",
  fileBehavior: "文件行为",
  system: "界面与快捷键",
};

export const SECTION_FILTER_ALIASES: Record<FieldAnchor, string[]> = {
  paths: ["path", "paths", "folder", "directory", "directories"],
  scrape: ["scrape", "crawler", "site", "sites", "source", "sources", "rate", "limit"],
  network: ["network", "proxy", "cookie", "retry", "timeout"],
  translate: ["translate", "translation", "translator", "llm", "language"],
  naming: ["naming", "name", "template", "rule", "rules"],
  download: ["download", "asset", "poster", "fanart", "nfo"],
  fileBehavior: ["behavior", "file", "move", "rename", "log"],
  system: ["system", "ui", "interface", "shortcut", "hotkey", "系统", "界面", "快捷键"],
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

const SITE_CUSTOM_URL_FIELDS: SiteCustomUrlFieldDefinition[] = Object.values(Website).map((site) => ({
  key: `scrape.siteConfigs.${site}.customUrl`,
  site,
  label: `${site} 站点地址`,
  anchor: "scrape",
  surface: "internal",
  description: `覆盖 ${site} 的内置地址，并用于当前配置下的连通性测试。`,
  aliases: [site, `${site} url`, `${site} 地址`, "custom url", "mirror", "站点地址", "连通性"],
}));

const SITE_CUSTOM_URL_ALIASES = Object.fromEntries(
  SITE_CUSTOM_URL_FIELDS.map((entry) => [entry.key, entry.aliases]),
) as Record<string, string[]>;

const SITE_BY_CUSTOM_URL_FIELD_KEY = new Map<string, Website>(
  SITE_CUSTOM_URL_FIELDS.map((entry) => [entry.key, entry.site]),
);

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
  ...SITE_CUSTOM_URL_ALIASES,
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

const RAW_FIELD_REGISTRY: Array<
  Pick<FieldEntry, "key" | "label" | "anchor" | "description"> & Partial<Pick<FieldEntry, "surface" | "visibility">>
> = [
  { key: "paths.mediaPath", label: "媒体目录", anchor: "paths" },
  { key: "paths.actorPhotoFolder", label: "演员头像库目录", anchor: "paths" },
  { key: "paths.softlinkPath", label: "软链接目录", anchor: "paths" },
  { key: "paths.successOutputFolder", label: "成功输出目录", anchor: "paths" },
  { key: "paths.failedOutputFolder", label: "失败输出目录", anchor: "paths" },
  { key: "paths.outputSummaryPath", label: "概览统计目录", anchor: "paths" },
  { key: "paths.sceneImagesFolder", label: "剧照目录名", anchor: "paths" },
  { key: "paths.configDirectory", label: "配置文件目录", anchor: "paths" },
  { key: "scrape.sites", label: "启用站点与优先级", anchor: "scrape" },
  ...SITE_CUSTOM_URL_FIELDS,
  { key: "scrape.threadNumber", label: "并发线程数", anchor: "scrape" },
  { key: "scrape.javdbDelaySeconds", label: "JavDB 请求延迟(秒)", anchor: "scrape" },
  { key: "scrape.restAfterCount", label: "连续刮削后休息(条数)", anchor: "scrape" },
  { key: "scrape.restDuration", label: "休息时长", anchor: "scrape" },
  { key: "network.proxyType", label: "代理类型", anchor: "network" },
  { key: "network.proxy", label: "代理地址", anchor: "network" },
  { key: "network.useProxy", label: "启用代理", anchor: "network" },
  { key: "network.timeout", label: "超时时间(秒)", anchor: "network" },
  { key: "network.retryCount", label: "重试次数", anchor: "network" },
  { key: "network.javdbCookie", label: "JavDB Cookie", anchor: "network" },
  { key: "network.javbusCookie", label: "JavBus Cookie", anchor: "network" },
  ...AGGREGATION_PRIORITY_FIELDS.map((entry) => ({
    key: entry.key,
    label: entry.label,
    anchor: "scrape" as const,
    description: entry.description,
  })),
  {
    key: "aggregation.maxParallelCrawlers",
    label: "聚合并行站点数",
    anchor: "scrape",
    description: "同一影片聚合抓取时，最多同时请求多少个站点。",
  },
  {
    key: "aggregation.perCrawlerTimeoutMs",
    label: "单站超时 (ms)",
    anchor: "scrape",
    description: "单个站点抓取在聚合阶段的最大等待时间。",
  },
  {
    key: "aggregation.globalTimeoutMs",
    label: "全局超时 (ms)",
    anchor: "scrape",
    description: "单部影片整次聚合抓取允许的总超时时间。",
  },
  { key: "download.downloadThumb", label: "下载横版缩略图", anchor: "download" },
  { key: "download.downloadPoster", label: "下载海报", anchor: "download" },
  { key: "download.tagBadges", label: "封面标签角标", anchor: "download" },
  { key: "download.downloadFanart", label: "下载背景图", anchor: "download" },
  { key: "download.downloadSceneImages", label: "下载剧照", anchor: "download" },
  { key: "download.downloadTrailer", label: "下载预告片", anchor: "download" },
  {
    key: "download.sceneImageConcurrency",
    label: "剧照下载并发",
    anchor: "download",
    description: "下载剧照时允许的并发请求数。",
  },
  { key: "download.generateNfo", label: "生成 NFO", anchor: "download" },
  { key: "download.nfoNaming", label: "NFO 文件命名", anchor: "download" },
  { key: "download.keepThumb", label: "保留已有横版缩略图", anchor: "download" },
  { key: "download.keepPoster", label: "保留已有海报", anchor: "download" },
  { key: "download.keepFanart", label: "保留已有背景图", anchor: "download" },
  { key: "download.keepSceneImages", label: "保留已有剧照", anchor: "download" },
  { key: "download.keepTrailer", label: "保留已有预告片", anchor: "download" },
  { key: "download.keepNfo", label: "保留已有 NFO", anchor: "download" },
  { key: "naming.folderTemplate", label: "文件夹模板", anchor: "naming" },
  { key: "naming.fileTemplate", label: "文件名模板", anchor: "naming" },
  { key: "naming.assetNamingMode", label: "附属文件命名", anchor: "naming" },
  { key: "naming.nfoTitleTemplate", label: "NFO 标题模板", anchor: "naming" },
  { key: "naming.actorNameMax", label: "演员名最大数量", anchor: "naming" },
  { key: "naming.actorNameMore", label: "演员名超出后缀", anchor: "naming" },
  { key: "naming.actorFallbackToStudio", label: "演员为空时使用片商或卖家", anchor: "naming" },
  { key: "naming.releaseRule", label: "发行日期格式", anchor: "naming" },
  { key: "naming.folderNameMax", label: "文件夹名最大长度", anchor: "naming" },
  { key: "naming.fileNameMax", label: "文件名最大长度", anchor: "naming" },
  { key: "naming.cnwordStyle", label: "中文字幕标记", anchor: "naming" },
  { key: "naming.umrStyle", label: "UMR 标记", anchor: "naming" },
  { key: "naming.leakStyle", label: "流出标记", anchor: "naming" },
  { key: "naming.uncensoredStyle", label: "无码标记", anchor: "naming" },
  { key: "naming.censoredStyle", label: "有码标记", anchor: "naming" },
  { key: "naming.partStyle", label: "分盘样式", anchor: "naming" },
  {
    key: "aggregation.behavior.preferLongerPlot",
    label: "简介优先取更长内容",
    anchor: "scrape",
    description: "多站点都提供简介时，优先选择更完整、更长的版本。",
  },
  {
    key: "aggregation.behavior.maxSceneImages",
    label: "最多保留剧照数",
    anchor: "scrape",
    description: "聚合后最多保留多少张剧照。",
  },
  {
    key: "aggregation.behavior.maxActors",
    label: "最多保留演员数",
    anchor: "scrape",
    description: "聚合后最多保留多少位演员。",
  },
  {
    key: "aggregation.behavior.maxGenres",
    label: "最多保留标签数",
    anchor: "scrape",
    description: "聚合后最多保留多少个类型或标签。",
  },
  { key: "translate.enableTranslation", label: "启用内容翻译", anchor: "translate" },
  { key: "translate.engine", label: "翻译引擎", anchor: "translate" },
  { key: "translate.llmModelName", label: "LLM 模型名称", anchor: "translate" },
  { key: "translate.llmApiKey", label: "LLM 密钥", anchor: "translate" },
  { key: "translate.llmBaseUrl", label: "LLM API 地址", anchor: "translate" },
  { key: "translate.llmPrompt", label: "LLM 翻译提示词", anchor: "translate" },
  { key: "translate.llmTemperature", label: "LLM 温度", anchor: "translate" },
  { key: "translate.llmMaxRetries", label: "LLM 最大重试次数", anchor: "translate" },
  { key: "translate.llmMaxRequestsPerSecond", label: "LLM 每秒最大请求数", anchor: "translate" },
  { key: "translate.targetLanguage", label: "目标语言", anchor: "translate" },
  { key: "personSync.personOverviewSources", label: "人物简介来源顺序", anchor: "system", surface: "tools" },
  { key: "personSync.personImageSources", label: "人物头像来源顺序", anchor: "system", surface: "tools" },
  { key: "jellyfin.url", label: "Jellyfin 服务器地址", anchor: "system", surface: "tools" },
  { key: "jellyfin.apiKey", label: "Jellyfin API Key", anchor: "system", surface: "tools" },
  { key: "jellyfin.userId", label: "Jellyfin 用户 ID", anchor: "system", surface: "tools" },
  { key: "jellyfin.refreshPersonAfterSync", label: "同步后刷新人物 (Jellyfin)", anchor: "system", surface: "tools" },
  {
    key: "jellyfin.lockOverviewAfterSync",
    label: "同步后锁定人物简介 (Jellyfin)",
    anchor: "system",
    surface: "tools",
  },
  { key: "emby.url", label: "Emby 服务器地址", anchor: "system", surface: "tools" },
  { key: "emby.apiKey", label: "Emby API Key", anchor: "system", surface: "tools" },
  { key: "emby.userId", label: "Emby 用户 ID", anchor: "system", surface: "tools" },
  { key: "emby.refreshPersonAfterSync", label: "同步后刷新人物 (Emby)", anchor: "system", surface: "tools" },
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
  { key: "behavior.successFileMove", label: "成功后移动文件", anchor: "fileBehavior" },
  { key: "behavior.failedFileMove", label: "失败后移动文件", anchor: "fileBehavior" },
  { key: "behavior.successFileRename", label: "成功后重命名文件", anchor: "fileBehavior" },
  { key: "behavior.deleteEmptyFolder", label: "删除空文件夹", anchor: "fileBehavior" },
  { key: "behavior.scrapeSoftlinkPath", label: "刮削软链接目录", anchor: "fileBehavior" },
  { key: "behavior.saveLog", label: "保存日志到文件", anchor: "fileBehavior" },
];

export const FIELD_REGISTRY: FieldEntry[] = RAW_FIELD_REGISTRY.map((entry) => ({
  ...entry,
  surface: entry.surface ?? "settings",
  visibility: entry.visibility ?? (ADVANCED_FIELD_KEYS.has(entry.key) ? "advanced" : "public"),
  aliases: FIELD_ALIASES[entry.key] ?? [],
}));

export const FIELD_KEYS = FIELD_REGISTRY.map((entry) => entry.key);

export const FIELD_REGISTRY_BY_KEY = Object.fromEntries(FIELD_REGISTRY.map((entry) => [entry.key, entry])) as Record<
  string,
  FieldEntry
>;

export function isFieldManagedBySettingsSearch(key: string): boolean {
  return FIELD_REGISTRY_BY_KEY[key]?.surface === "settings";
}

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
    const value = getNestedValue(data, entry.key);
    flat[entry.key] = value === undefined && SITE_BY_CUSTOM_URL_FIELD_KEY.has(entry.key) ? "" : value;
  }

  const siteConfigs = getNestedValue(data, "scrape.siteConfigs");
  if (isRecord(siteConfigs)) {
    for (const [site, config] of Object.entries(siteConfigs)) {
      if (!isRecord(config)) {
        continue;
      }
      if ("customUrl" in config) {
        flat[`scrape.siteConfigs.${site}.customUrl`] = config.customUrl ?? "";
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

export const SECTION_ORDER = ["paths", "scrape", "network", "translate", "naming", "download", "system"] as const;

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

export const SECTION_LABELS: Record<FieldAnchor, string> = {
  paths: "媒体库与输出",
  scrape: "刮削设置",
  network: "网络连接",
  translate: "翻译服务",
  naming: "命名规则",
  download: "下载选项",
  system: "界面与快捷键",
};

export const SECTION_FILTER_ALIASES: Record<FieldAnchor, string[]> = {
  paths: [
    "path",
    "paths",
    "folder",
    "directory",
    "directories",
    "media",
    "output",
    "move",
    "rename",
    "behavior",
    "file",
    "媒体库",
    "整理",
    "输出",
    "移动",
    "重命名",
    "strm",
    "元数据",
    "归档",
  ],
  scrape: ["scrape", "crawler", "site", "sites", "source", "sources", "rate", "limit"],
  network: ["network", "proxy", "cookie", "retry", "timeout"],
  translate: ["translate", "translation", "translator", "llm", "language"],
  naming: ["naming", "name", "template", "rule", "rules"],
  download: ["download", "asset", "poster", "fanart", "nfo"],
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

const SITE_PRIORITY_EDITOR_ALIASES = [
  "site priority",
  "网站优先级",
  "站点优先级",
  "排序",
  "DMM",
  "FANZA",
  "DMM TV",
  "MGStage",
  "Prestige",
  "Faleno",
  "Dahlia",
  "KM Produce",
  "Sokmil",
  "Kingdom",
  "JavDB",
  "JavBus",
  "Jav321",
  "AVBase",
  "FC2",
  "FC2Hub",
  "H0930",
  "H4610",
  "PPVDataBank",
  "R18.dev",
  "AVWikiDB",
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
  "behavior.metadataOnly": ["metadata", "only", "只读", "仅输出元数据", "网盘", "原视频不动"],
  "paths.metadataPath": ["metadata", "sidecar", "strm", "元数据", "本地目录", "元数据目录"],
  "paths.strmPathMappings": ["strm", "mapping", "播放器", "路径映射", "UNC"],
  "behavior.generateStrm": ["strm", "播放流", "串流", "流媒体"],
  "paths.actorPhotoFolder": ["actor", "photo", "头像", "演员"],
  "paths.successOutputFolder": ["output", "success", "成功目录"],
  "paths.defaultScanExcludeDirs": ["scan exclude", "exclude dirs", "排除目录", "扫描排除"],
  "paths.outputSummaryPath": ["summary", "overview", "概览目录"],
  "paths.configDirectory": ["config", "profile", "配置目录"],
  "scrape.sites": SITE_PRIORITY_EDITOR_ALIASES,
  "network.javdbCookie": ["cookie", "javdb", "凭证"],
  "network.javbusCookie": ["cookie", "javbus", "凭证"],
  "network.fantiaCookie": ["cookie", "fantia", "凭证"],
  "translate.engine": ["translator", "translation", "翻译引擎"],
  "translate.llmModelName": ["model", "openai", "llm"],
  "translate.llmApiKey": ["api key", "token", "openai key", "密钥"],
  "translate.llmBaseUrl": ["base url", "endpoint", "api 地址"],
  "translate.llmPrompt": ["prompt", "提示词"],
  "translate.llmReasoning": ["reasoning", "thinking", "思考", "推理强度"],
  "translate.targetLanguage": ["language", "locale", "语言"],
  "naming.folderTemplate": ["template", "folder naming", "命名模板"],
  "naming.fileTemplate": ["template", "file naming", "命名模板"],
  "titleRepair.enabled": ["title repair", "masked title", "标题修复", "遮蔽标题"],
  "titleRepair.rules": ["title repair", "replacement", "replace", "标题替换", "修复规则"],
  "download.generateNfo": ["nfo", "metadata file"],
  "download.nfoNaming": ["nfo", "naming", "metadata file"],
  "download.nfoIgnoreFields": [
    "nfo",
    "metadata file",
    "num",
    "number",
    "plot",
    "release",
    "runtime",
    "technical",
    "rating",
    "studio",
    "director",
    "publisher",
    "series",
    "genres",
    "tags",
    "poster",
    "thumb",
    "fanart",
    "sceneImages",
    "trailer",
    "source",
    "简介",
    "发行信息",
    "时长",
    "技术信息",
    "评分",
    "片商",
    "导演",
    "发行商",
    "系列",
    "类型",
    "标签",
    "海报",
    "缩略图",
    "背景图",
    "剧照",
    "预告片",
    "来源",
    "番号",
  ],
  "download.tagBadges": ["badge", "badges", "mark", "corner", "角标", "标签角标"],
  "download.tagBadgeTypes": [
    "badge types",
    "badge filters",
    "subtitle",
    "censored",
    "umr",
    "leak",
    "uncensored",
    "fullhd",
    "1080p",
    "2160p",
    "4k",
    "8k",
    "中字",
    "有码",
    "破解",
    "流出",
    "无码",
    "1080P",
    "4K",
    "8K",
  ],
  "download.tagBadgePosition": [
    "badge position",
    "corner",
    "top left",
    "top right",
    "bottom left",
    "bottom right",
    "角标位置",
  ],
  "download.tagBadgeImageOverrides": [
    "watermark",
    "badge image",
    "custom badge",
    "poster badge image",
    "覆盖角标",
    "角标图片",
    "水印",
  ],
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
  {
    key: "paths.defaultScanExcludeDirs",
    label: "默认扫描排除目录",
    anchor: "paths",
    description: "扫描媒体库时自动跳过这些文件夹。",
  },
  { key: "behavior.successFileMove", label: "移动视频与字幕", anchor: "paths" },
  { key: "paths.successOutputFolder", label: "整理目标目录", anchor: "paths" },
  { key: "behavior.successFileRename", label: "重命名视频与字幕", anchor: "paths" },
  {
    key: "behavior.metadataOnly",
    label: "仅输出元数据",
    anchor: "paths",
    description: "不移动原视频，仅将海报与 NFO 输出到独立目录（适合网盘挂载等场景）。",
  },
  {
    key: "paths.metadataPath",
    label: "元数据输出目录",
    anchor: "paths",
    description: "启用“仅输出元数据”时必填。存放 NFO、海报及 .strm 播放流文件的目录。",
  },
  {
    key: "behavior.generateStrm",
    label: "同时生成 .strm 播放流文件",
    anchor: "paths",
    description: "在元数据目录生成 .strm 文件，供 Emby / Jellyfin 挂载串流播放。",
  },
  {
    key: "paths.strmPathMappings",
    label: "STRM 路径映射（可选）",
    anchor: "paths",
    description: "当启用生成 .strm 文件时，替换其中的本地视频路径为播放器可见路径。",
  },
  { key: "paths.actorPhotoFolder", label: "本地演员头像库目录", anchor: "paths" },
  { key: "paths.sceneImagesFolder", label: "剧照目录名", anchor: "paths" },
  { key: "paths.outputSummaryPath", label: "概览统计目录", anchor: "paths" },
  { key: "paths.configDirectory", label: "配置文件目录", anchor: "paths" },
  {
    key: "scrape.sites",
    label: "启用站点与优先级",
    anchor: "scrape",
    description: "按分组显示 DMM/FANZA 系、厂商官网和常用聚合站点，并保持保存值仍为具体站点顺序。",
  },
  {
    key: "scrape.r18MetadataLanguage",
    label: "R18.dev 元数据语言",
    anchor: "scrape",
    visibility: "hidden",
    description: "R18.dev 行内语言偏好，由启用站点与优先级控件保存。",
  },
  {
    key: "scrape.filenameIgnoreTokens",
    label: "文件名番号忽略词",
    anchor: "scrape",
    description: "番号识别前从文件名中忽略这些文字；仅影响识别，不会修改原始文件名。",
  },
  {
    key: "scrape.filenameBlacklistTokens",
    label: "文件名黑名单词",
    anchor: "scrape",
    description: "自动扫描时排除文件名中包含这些文字的影片。",
  },
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
  { key: "network.fantiaCookie", label: "Fantia Cookie", anchor: "network" },
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
  { key: "download.tagBadgeTypes", label: "角标类型", anchor: "download" },
  { key: "download.tagBadgePosition", label: "角标位置", anchor: "download" },
  { key: "download.tagBadgeImageOverrides", label: "覆盖角标图片", anchor: "download" },
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
  {
    key: "download.nfoIgnoreFields",
    label: "NFO 忽略字段",
    anchor: "download",
    description: "选择不写入 NFO 的可选字段；标题、番号、演员等核心字段始终保留。空白表示写入全部可选字段。",
  },
  { key: "download.keepThumb", label: "保留已有横版缩略图", anchor: "download" },
  { key: "download.keepPoster", label: "保留已有海报", anchor: "download" },
  { key: "download.keepFanart", label: "保留已有背景图", anchor: "download" },
  { key: "download.keepSceneImages", label: "保留已有剧照", anchor: "download" },
  { key: "download.keepTrailer", label: "保留已有预告片", anchor: "download" },
  { key: "download.keepNfo", label: "保留已有 NFO", anchor: "download" },
  { key: "naming.folderTemplate", label: "文件夹模板", anchor: "naming" },
  { key: "naming.fileTemplate", label: "文件名模板", anchor: "naming" },
  {
    key: "titleRepair.enabled",
    label: "标题屏蔽词还原",
    anchor: "naming",
    description:
      "自动将官方标题中的避讳符号（●、〇 等）还原为原始词汇（例如把「催●」还原为「催眠」，「盗●」还原为「盗撮」）；原始标题仍会保留在 NFO 中。",
  },
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
  { key: "translate.llmApiFormat", label: "OpenAI API 形式", anchor: "translate" },
  { key: "translate.llmServiceType", label: "LLM 服务类型", anchor: "translate" },
  { key: "translate.llmPrompt", label: "LLM 翻译提示词", anchor: "translate" },
  { key: "translate.llmTemperature", label: "LLM 温度", anchor: "translate" },
  { key: "translate.llmReasoning", label: "LLM 推理强度", anchor: "translate" },
  { key: "translate.llmOutputFormat", label: "LLM 输出格式", anchor: "translate" },
  { key: "translate.llmTimeout", label: "LLM 请求超时", anchor: "translate" },
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
  { key: "shortcuts.openFolder", label: "打开所在目录", anchor: "system" },
  { key: "shortcuts.editNfo", label: "编辑 NFO", anchor: "system" },
  { key: "shortcuts.playVideo", label: "播放视频", anchor: "system" },
  { key: "ui.showLogsPanel", label: "显示日志面板", anchor: "system" },
  { key: "ui.useCustomTitleBar", label: "使用自定义标题栏", anchor: "system" },
  { key: "ui.hideDock", label: "隐藏 Dock 图标", anchor: "system" },
  { key: "ui.hideMenu", label: "隐藏菜单栏", anchor: "system" },
  { key: "ui.hideWindowButtons", label: "隐藏窗口按钮", anchor: "system" },
];

export const FIELD_REGISTRY: FieldEntry[] = RAW_FIELD_REGISTRY.map((entry) => ({
  ...entry,
  surface: entry.surface ?? "settings",
  visibility: entry.visibility ?? (ADVANCED_FIELD_KEYS.has(entry.key) ? "advanced" : "public"),
  aliases: FIELD_ALIASES[entry.key] ?? [],
}));

export const FIELD_KEYS = FIELD_REGISTRY.map((entry) => entry.key);

export interface SettingsSchemaExemption {
  path: string;
  kind: "internal" | "dynamic-record";
  reason: string;
}

export const SETTINGS_SCHEMA_EXEMPTIONS: SettingsSchemaExemption[] = [
  {
    path: "personSync.actorAliases",
    kind: "dynamic-record",
    reason: "Actor aliases are user-defined keys and cannot be represented as static registry leaves.",
  },
  { path: "ui.language", kind: "internal", reason: "Language selection is not exposed by the current settings UI." },
  { path: "ui.theme", kind: "internal", reason: "Theme is controlled by the application shell." },
  {
    path: "behavior.updateCheck",
    kind: "internal",
    reason: "Update checks are controlled by the Desktop lifecycle rather than the settings editor.",
  },
];

export interface SettingsSchemaDiff {
  registryOnly: string[];
  schemaOnly: string[];
  staleExemptions: string[];
}

export function diffSettingsRegistrySchemaPaths(
  schemaPaths: readonly string[],
  registryPaths: readonly string[],
  exemptions: readonly SettingsSchemaExemption[] = SETTINGS_SCHEMA_EXEMPTIONS,
): SettingsSchemaDiff {
  const schema = new Set(schemaPaths);
  const registry = new Set(registryPaths);
  const exemptionPaths = new Set(exemptions.map((entry) => entry.path));

  return {
    registryOnly: registryPaths.filter((path) => !schema.has(path)),
    schemaOnly: schemaPaths.filter((path) => !registry.has(path) && !exemptionPaths.has(path)),
    staleExemptions: exemptions.map((entry) => entry.path).filter((path) => !schema.has(path) || registry.has(path)),
  };
}

export const FIELD_REGISTRY_BY_KEY = Object.fromEntries(FIELD_REGISTRY.map((entry) => [entry.key, entry])) as Record<
  string,
  FieldEntry
>;

export const SETTINGS_FIELD_REGISTRY = FIELD_REGISTRY.filter((entry) => entry.surface === "settings");

export function isFieldManagedBySettingsSearch(key: string): boolean {
  return FIELD_REGISTRY_BY_KEY[key]?.surface === "settings";
}

export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cursor: unknown = obj;
  for (const part of parts) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

export function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor: Record<string, unknown> = obj;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== "object") cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  const tail = parts.at(-1);
  if (tail) cursor[tail] = value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function flattenConfig(data: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const entry of FIELD_REGISTRY) {
    flat[entry.key] = getNestedValue(data, entry.key);
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

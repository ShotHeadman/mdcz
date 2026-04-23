import { ACTOR_IMAGE_SOURCE_OPTIONS, ACTOR_OVERVIEW_SOURCE_OPTIONS } from "@main/services/actorSource/types";
import { CURRENT_CONFIG_VERSION } from "@main/services/config/migrator";
import { ASSET_NAMING_MODES, isSharedDirectoryMode } from "@shared/assetNaming";
import { ProxyType, ThemeMode, TRANSLATION_TARGET_OPTIONS, TranslateEngine, UiLanguage, Website } from "@shared/enums";
import { DEFAULT_LLM_BASE_URL } from "@shared/llm";
import { z } from "zod";

const DEFAULT_SITES: Website[] = [
  Website.DMM,
  Website.DMM_TV,
  Website.MGSTAGE,
  Website.PRESTIGE,
  Website.FALENO,
  Website.DAHLIA,
  Website.FC2,
  Website.FC2HUB,
  Website.JAVDB,
  Website.JAVBUS,
  Website.JAV321,
  Website.KM_PRODUCE,
  Website.AVBASE,
];

const PART_STYLE_OPTIONS = ["RAW", "CD", "PART", "DISC"] as const;
const NFO_NAMING_OPTIONS = ["both", "movie", "filename"] as const;
const OPTIONAL_GROUP_WITH_PATH_SEPARATOR = /\[[^[\]]*[\\/][^[\]]*\]/u;

const networkSchema = z.object({
  proxyType: z.enum(ProxyType).default(ProxyType.NONE),
  proxy: z.string().default(""),
  useProxy: z.boolean().default(false),
  timeout: z.number().int().min(1).max(300).default(10),
  retryCount: z.number().int().min(0).max(10).default(3),
  javdbCookie: z.string().default(""),
  javbusCookie: z.string().default(""),
});

const siteConfigSchema = z.object({
  customUrl: z.url().or(z.literal("")).default(""),
});

const scrapeSchema = z.object({
  sites: z.array(z.enum(Website)).default(DEFAULT_SITES),
  threadNumber: z.number().int().min(1).max(128).default(2),
  javdbDelaySeconds: z.number().int().min(0).max(120).default(10),
  restAfterCount: z.number().int().min(1).max(500).default(20),
  restDuration: z.number().int().min(0).default(60),
  siteConfigs: z.record(z.string(), siteConfigSchema).default({}),
});

const namingSchema = z.object({
  folderTemplate: z.string().default("{actor}/{number}"),
  fileTemplate: z.string().default("{number}"),
  assetNamingMode: z.enum(ASSET_NAMING_MODES).default("fixed"),
  nfoTitleTemplate: z.string().default("{title}"),
  actorNameMax: z.number().int().min(1).max(20).default(3),
  actorNameMore: z.string().default("等演员"),
  actorFallbackToStudio: z.boolean().default(false),
  releaseRule: z.string().default("YYYY-MM-DD"),
  folderNameMax: z.number().int().min(10).max(255).default(60),
  fileNameMax: z.number().int().min(10).max(255).default(60),
  cnwordStyle: z.string().default("-C"),
  umrStyle: z.string().default("-破解"),
  leakStyle: z.string().default("-流出"),
  uncensoredStyle: z.string().default(""),
  censoredStyle: z.string().default(""),
  partStyle: z.enum(PART_STYLE_OPTIONS).default("RAW"),
});

const translationTargetSchema = z
  .enum(TRANSLATION_TARGET_OPTIONS)
  .catch(TRANSLATION_TARGET_OPTIONS[0])
  .default(TRANSLATION_TARGET_OPTIONS[0]);

const translateSchema = z.object({
  enableTranslation: z.boolean().default(false),
  engine: z.enum(TranslateEngine).default(TranslateEngine.OPENAI),
  llmModelName: z.string().default("gpt-5.2"),
  llmApiKey: z.string().default(""),
  llmBaseUrl: z.url().or(z.literal("")).default(DEFAULT_LLM_BASE_URL),
  llmPrompt: z.string().default("自动识别原文语言，将以下内容翻译为{lang}。只输出最终翻译结果。\\n{content}"),
  llmTemperature: z.number().min(0).max(2).default(1.0),
  llmMaxRetries: z.number().int().min(1).max(20).default(3),
  llmMaxRequestsPerSecond: z.number().int().min(1).max(100).default(1),
  targetLanguage: translationTargetSchema,
});

const downloadSchema = z.object({
  downloadThumb: z.boolean().default(true),
  downloadPoster: z.boolean().default(true),
  tagBadges: z.boolean().default(false),
  downloadFanart: z.boolean().default(true),
  downloadSceneImages: z.boolean().default(true),
  downloadTrailer: z.boolean().default(true),
  generateNfo: z.boolean().default(true),
  nfoNaming: z.enum(NFO_NAMING_OPTIONS).default("both"),
  sceneImageConcurrency: z.number().int().min(1).max(20).default(5),
  keepThumb: z.boolean().default(true),
  keepPoster: z.boolean().default(true),
  keepFanart: z.boolean().default(true),
  keepSceneImages: z.boolean().default(true),
  keepTrailer: z.boolean().default(true),
  keepNfo: z.boolean().default(true),
});

const personSyncSchema = z.object({
  personOverviewSources: z.array(z.enum(ACTOR_OVERVIEW_SOURCE_OPTIONS)).default(["official", "avjoho", "avbase"]),
  personImageSources: z.array(z.enum(ACTOR_IMAGE_SOURCE_OPTIONS)).default(["local", "gfriends", "official", "avbase"]),
});

const jellyfinSchema = z.object({
  url: z.url().or(z.literal("")).default("http://127.0.0.1:8096"),
  apiKey: z.string().default(""),
  userId: z.string().default(""),
  refreshPersonAfterSync: z.boolean().default(true),
  lockOverviewAfterSync: z.boolean().default(false),
});

const embySchema = z.object({
  url: z.url().or(z.literal("")).default(""),
  apiKey: z.string().default(""),
  userId: z.string().default(""),
  refreshPersonAfterSync: z.boolean().default(true),
});

const shortcutsSchema = z.object({
  startOrStopScrape: z.string().default("S"),
  retryScrape: z.string().default("R"),
  deleteFile: z.string().default("D"),
  deleteFileAndFolder: z.string().default("Shift+D"),
  openFolder: z.string().default("F"),
  editNfo: z.string().default("E"),
  playVideo: z.string().default("P"),
});

const uiSchema = z.object({
  language: z.enum(UiLanguage).default(UiLanguage.ZH_CN),
  theme: z.enum(ThemeMode).default(ThemeMode.SYSTEM),
  showLogsPanel: z.boolean().default(true),
  hideDock: z.boolean().default(false),
  hideMenu: z.boolean().default(false),
  hideWindowButtons: z.boolean().default(false),
  useCustomTitleBar: z.boolean().default(true),
});

const pathsSchema = z.object({
  mediaPath: z.string().default(""),
  actorPhotoFolder: z.string().default("actor_photo"),
  softlinkPath: z.string().default("softlink"),
  successOutputFolder: z.string().default("JAV_output"),
  failedOutputFolder: z.string().default("failed"),
  sceneImagesFolder: z.string().default("extrafanart"),
  configDirectory: z.string().default("config"),
  outputSummaryPath: z.string().default(""),
});

const behaviorSchema = z.object({
  successFileMove: z.boolean().default(true),
  failedFileMove: z.boolean().default(true),
  successFileRename: z.boolean().default(true),
  deleteEmptyFolder: z.boolean().default(true),
  scrapeSoftlinkPath: z.boolean().default(false),
  saveLog: z.boolean().default(true),
  updateCheck: z.boolean().default(true),
});

const fieldPrioritiesSchema = z.object({
  title: z
    .array(z.enum(Website))
    .default([
      Website.AVBASE,
      Website.MGSTAGE,
      Website.DMM,
      Website.DMM_TV,
      Website.AVWIKIDB,
      Website.FC2HUB,
      Website.FC2,
      Website.JAVDB,
      Website.JAVBUS,
      Website.JAV321,
    ]),
  plot: z
    .array(z.enum(Website))
    .default([
      Website.AVBASE,
      Website.MGSTAGE,
      Website.DMM,
      Website.DMM_TV,
      Website.FC2,
      Website.FC2HUB,
      Website.JAV321,
      Website.AVWIKIDB,
    ]),
  actors: z
    .array(z.enum(Website))
    .default([
      Website.AVBASE,
      Website.MGSTAGE,
      Website.DMM,
      Website.AVWIKIDB,
      Website.FC2HUB,
      Website.JAVDB,
      Website.JAVBUS,
    ]),
  genres: z
    .array(z.enum(Website))
    .default([
      Website.AVBASE,
      Website.DMM,
      Website.AVWIKIDB,
      Website.FC2,
      Website.FC2HUB,
      Website.JAVDB,
      Website.JAVBUS,
    ]),
  thumb_url: z
    .array(z.enum(Website))
    .default([
      Website.AVBASE,
      Website.MGSTAGE,
      Website.DMM,
      Website.AVWIKIDB,
      Website.FC2,
      Website.FC2HUB,
      Website.JAVDB,
      Website.JAVBUS,
    ]),
  poster_url: z
    .array(z.enum(Website))
    .default([
      Website.AVBASE,
      Website.MGSTAGE,
      Website.DMM,
      Website.AVWIKIDB,
      Website.FC2,
      Website.FC2HUB,
      Website.JAVDB,
      Website.JAVBUS,
    ]),
  scene_images: z
    .array(z.enum(Website))
    .default([
      Website.AVBASE,
      Website.MGSTAGE,
      Website.DMM,
      Website.AVWIKIDB,
      Website.FC2,
      Website.FC2HUB,
      Website.JAVDB,
      Website.JAVBUS,
    ]),
  studio: z
    .array(z.enum(Website))
    .default([
      Website.AVBASE,
      Website.DMM,
      Website.AVWIKIDB,
      Website.FC2,
      Website.FC2HUB,
      Website.JAVDB,
      Website.JAVBUS,
    ]),
  director: z.array(z.enum(Website)).default([Website.AVBASE, Website.DMM, Website.JAVDB, Website.AVWIKIDB]),
  publisher: z
    .array(z.enum(Website))
    .default([Website.AVBASE, Website.DMM, Website.AVWIKIDB, Website.FC2, Website.FC2HUB, Website.JAVDB]),
  series: z
    .array(z.enum(Website))
    .default([Website.AVBASE, Website.DMM, Website.JAVDB, Website.JAVBUS, Website.AVWIKIDB]),
  release_date: z
    .array(z.enum(Website))
    .default([
      Website.AVBASE,
      Website.DMM,
      Website.AVWIKIDB,
      Website.FC2,
      Website.FC2HUB,
      Website.JAVDB,
      Website.JAVBUS,
    ]),
  durationSeconds: z.array(z.enum(Website)).default([Website.AVBASE, Website.DMM_TV, Website.AVWIKIDB, Website.FC2HUB]),
  rating: z.array(z.enum(Website)).default([Website.DMM_TV, Website.DMM, Website.FC2HUB, Website.JAVDB]),
  trailer_url: z.array(z.enum(Website)).default([Website.DMM_TV, Website.DMM, Website.JAVBUS, Website.AVWIKIDB]),
});

const aggregationBehaviorSchema = z.object({
  preferLongerPlot: z.boolean().default(true),
  maxSceneImages: z.number().int().min(0).max(100).default(30),
  maxActors: z.number().int().min(1).max(100).default(50),
  maxGenres: z.number().int().min(1).max(100).default(30),
});

const aggregationSchema = z
  .object({
    maxParallelCrawlers: z.number().int().min(1).max(10).default(3),
    perCrawlerTimeoutMs: z.number().int().min(5000).max(120000).default(20000),
    globalTimeoutMs: z.number().int().min(10000).max(300000).default(60000),
    fieldPriorities: fieldPrioritiesSchema.default(() => fieldPrioritiesSchema.parse({})),
    behavior: aggregationBehaviorSchema.default(() => aggregationBehaviorSchema.parse({})),
  })
  .superRefine((data, ctx) => {
    if (data.globalTimeoutMs <= data.perCrawlerTimeoutMs) {
      ctx.addIssue({
        code: "custom",
        path: ["globalTimeoutMs"],
        message: "全局超时必须大于单爬虫超时",
      });
    }
  });

export const configurationSchema = z
  .object({
    configVersion: z.number().int().default(CURRENT_CONFIG_VERSION),
    network: networkSchema.default(() => networkSchema.parse({})),
    scrape: scrapeSchema.default(() => scrapeSchema.parse({})),
    naming: namingSchema.default(() => namingSchema.parse({})),
    translate: translateSchema.default(() => translateSchema.parse({})),
    download: downloadSchema.default(() => downloadSchema.parse({})),
    personSync: personSyncSchema.default(() => personSyncSchema.parse({})),
    jellyfin: jellyfinSchema.default(() => jellyfinSchema.parse({})),
    emby: embySchema.default(() => embySchema.parse({})),
    shortcuts: shortcutsSchema.default(() => shortcutsSchema.parse({})),
    ui: uiSchema.default(() => uiSchema.parse({})),
    paths: pathsSchema.default(() => pathsSchema.parse({})),
    behavior: behaviorSchema.default(() => behaviorSchema.parse({})),
    aggregation: aggregationSchema.default(() => aggregationSchema.parse({})),
  })
  .superRefine((data, ctx) => {
    const sharedDirectoryMode = isSharedDirectoryMode({
      successFileMove: data.behavior.successFileMove,
      folderTemplate: data.naming.folderTemplate,
    });

    if (sharedDirectoryMode && data.naming.assetNamingMode !== "followVideo") {
      ctx.addIssue({
        code: "custom",
        path: ["naming", "assetNamingMode"],
        message: "共享目录模式下，附属文件命名必须使用“跟随影片文件名”",
      });
    }

    if (sharedDirectoryMode && data.download.nfoNaming !== "filename") {
      ctx.addIssue({
        code: "custom",
        path: ["download", "nfoNaming"],
        message: "共享目录模式下，NFO 文件命名必须使用“仅 文件名.nfo”",
      });
    }

    if (sharedDirectoryMode && data.download.downloadSceneImages) {
      ctx.addIssue({
        code: "custom",
        path: ["download", "downloadSceneImages"],
        message: "共享目录模式下不支持下载剧照，请关闭“下载剧照”",
      });
    }

    for (const [field, template] of [
      ["folderTemplate", data.naming.folderTemplate],
      ["fileTemplate", data.naming.fileTemplate],
    ] as const) {
      if (!OPTIONAL_GROUP_WITH_PATH_SEPARATOR.test(template)) {
        continue;
      }

      ctx.addIssue({
        code: "custom",
        path: ["naming", field],
        message: "[] 可选段不能包含路径分隔符，请仅在单个路径片段内使用可选内容",
      });
    }

    if (
      data.jellyfin.userId.trim().length > 0 &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(data.jellyfin.userId.trim())
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["jellyfin", "userId"],
        message: "Jellyfin 用户 ID 必须为 UUID，留空则按服务端默认处理",
      });
    }
  });

export type Configuration = z.infer<typeof configurationSchema>;

export type DeepPartial<T> =
  T extends Array<infer U> ? Array<DeepPartial<U>> : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

export const defaultConfiguration: Configuration = configurationSchema.parse({});

const siteConfigDefault = siteConfigSchema.parse({});

export type ConfigurationPathDefault = { found: true; value: unknown } | { found: false };

function getNestedConfigurationDefault(path: string): unknown {
  const parts = path.split(".");
  let cursor: unknown = defaultConfiguration;

  for (const part of parts) {
    if (cursor == null || typeof cursor !== "object" || !(part in cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }

  return cursor;
}

export function getConfigurationPathDefault(path: string): ConfigurationPathDefault {
  const staticDefault = getNestedConfigurationDefault(path);
  if (staticDefault !== undefined) {
    return { found: true, value: staticDefault };
  }

  const [root, collection, site, field, ...rest] = path.split(".");
  if (
    root === "scrape" &&
    collection === "siteConfigs" &&
    Boolean(site) &&
    field === "customUrl" &&
    rest.length === 0 &&
    Object.hasOwn(siteConfigDefault, field)
  ) {
    return { found: true, value: siteConfigDefault.customUrl };
  }

  return { found: false };
}

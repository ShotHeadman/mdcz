import { ACTOR_IMAGE_SOURCE_OPTIONS, ACTOR_OVERVIEW_SOURCE_OPTIONS } from "@main/services/actorSource/types";
import { ProxyType, ThemeMode, TranslateEngine, UiLanguage, Website } from "@shared/enums";
import { z } from "zod";

const DEFAULT_ENABLED_SITES: Website[] = [
  Website.DMM,
  Website.DMM_TV,
  Website.MGSTAGE,
  Website.PRESTIGE,
  Website.FALENO,
  Website.DAHLIA,
  Website.FC2,
  Website.JAVDB,
  Website.JAVBUS,
  Website.JAV321,
  Website.KM_PRODUCE,
];

const DEFAULT_SITE_ORDER: Website[] = [...DEFAULT_ENABLED_SITES];

const networkSchema = z.object({
  proxyType: z.enum(ProxyType).default(ProxyType.NONE),
  proxy: z.string().default(""),
  useProxy: z.boolean().default(false),
  timeout: z.number().int().min(1).max(300).default(20),
  retryCount: z.number().int().min(0).max(10).default(3),
  javdbCookie: z.string().default(""),
  javbusCookie: z.string().default(""),
});

const siteConfigSchema = z.object({
  customUrl: z.url().or(z.literal("")).default(""),
});

const scrapeSchema = z.object({
  enabledSites: z.array(z.enum(Website)).default(DEFAULT_ENABLED_SITES),
  siteOrder: z.array(z.enum(Website)).default(DEFAULT_SITE_ORDER),
  threadNumber: z.number().int().min(1).max(128).default(2),
  javdbDelaySeconds: z.number().int().min(0).max(120).default(10),
  restAfterCount: z.number().int().min(1).max(500).default(20),
  restDuration: z.number().int().min(0).default(60),
  siteConfigs: z.record(z.string(), siteConfigSchema).default({}),
});

const namingSchema = z.object({
  folderTemplate: z.string().default("{actor}/{number}"),
  fileTemplate: z.string().default("{number}"),
  actorNameMax: z.number().int().min(1).max(20).default(3),
  actorNameMore: z.string().default("等演员"),
  releaseRule: z.string().default("YYYY-MM-DD"),
  folderNameMax: z.number().int().min(10).max(255).default(60),
  fileNameMax: z.number().int().min(10).max(255).default(60),
  cnwordStyle: z.string().default("-C"),
  umrStyle: z.string().default("-破解"),
  leakStyle: z.string().default("-流出"),
  uncensoredStyle: z.string().default(""),
  censoredStyle: z.string().default(""),
});

const translateSchema = z.object({
  enableTranslation: z.boolean().default(false),
  engine: z.enum(TranslateEngine).default(TranslateEngine.OPENAI),
  llmModelName: z.string().default("gpt-5.2"),
  llmApiKey: z.string().default(""),
  llmBaseUrl: z.url().or(z.literal("")).default(""),
  llmPrompt: z.string().default("请将以下文本翻译成{lang}。只输出翻译结果。\\n{content}"),
  llmTemperature: z.number().min(0).max(2).default(1.0),
  llmMaxTry: z.number().int().min(1).max(20).default(3),
  llmMaxRequestsPerSecond: z.number().positive().default(1),
  enableGoogleFallback: z.boolean().default(true),
  titleLanguage: z.enum(UiLanguage).default(UiLanguage.ZH_CN),
  plotLanguage: z.enum(UiLanguage).default(UiLanguage.ZH_CN),
});

const downloadSchema = z.object({
  downloadThumb: z.boolean().default(true),
  downloadPoster: z.boolean().default(true),
  downloadFanart: z.boolean().default(true),
  downloadSceneImages: z.boolean().default(true),
  downloadTrailer: z.boolean().default(true),
  downloadNfo: z.boolean().default(true),
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
  personImageSources: z
    .array(z.enum(ACTOR_IMAGE_SOURCE_OPTIONS))
    .default(["local", "official", "gfriends", "avjoho", "avbase"]),
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
  searchByNumber: z.string().default("N"),
  searchByUrl: z.string().default("U"),
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
});

const pathsSchema = z.object({
  mediaPath: z.string().default(""),
  actorPhotoFolder: z.string().default("actor_photo"),
  softlinkPath: z.string().default("softlink"),
  successOutputFolder: z.string().default("JAV_output"),
  failedOutputFolder: z.string().default("failed"),
  sceneImagesFolder: z.string().default("extrafanart"),
  configDirectory: z.string().default("config"),
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
      Website.DMM,
      Website.MGSTAGE,
      Website.DMM_TV,
      Website.FC2,
      Website.JAVDB,
      Website.JAVBUS,
      Website.JAV321,
      Website.KM_PRODUCE,
    ]),
  plot: z.array(z.enum(Website)).default([Website.MGSTAGE, Website.DMM, Website.DMM_TV, Website.FC2, Website.JAV321]),
  actors: z
    .array(z.enum(Website))
    .default([Website.JAVDB, Website.DMM, Website.JAVBUS, Website.MGSTAGE, Website.KM_PRODUCE]),
  actor_profiles: z.array(z.enum(Website)).default([Website.JAVDB, Website.MGSTAGE, Website.DMM]),
  genres: z
    .array(z.enum(Website))
    .default([Website.JAVDB, Website.FC2, Website.DMM, Website.JAVBUS, Website.KM_PRODUCE]),
  thumb_url: z
    .array(z.enum(Website))
    .default([Website.DMM, Website.FC2, Website.JAVDB, Website.JAVBUS, Website.KM_PRODUCE]),
  poster_url: z
    .array(z.enum(Website))
    .default([Website.DMM, Website.FC2, Website.JAVDB, Website.JAVBUS, Website.KM_PRODUCE]),
  sample_images: z.array(z.enum(Website)).default([Website.MGSTAGE, Website.DMM, Website.JAVBUS, Website.JAVDB]),
  studio: z
    .array(z.enum(Website))
    .default([Website.DMM, Website.FC2, Website.JAVDB, Website.JAVBUS, Website.KM_PRODUCE]),
  director: z.array(z.enum(Website)).default([Website.DMM, Website.JAVDB]),
  publisher: z.array(z.enum(Website)).default([Website.DMM, Website.FC2, Website.JAVDB]),
  series: z.array(z.enum(Website)).default([Website.DMM, Website.JAVDB, Website.JAVBUS]),
  release_date: z
    .array(z.enum(Website))
    .default([Website.DMM, Website.FC2, Website.JAVDB, Website.JAVBUS, Website.KM_PRODUCE]),
  rating: z.array(z.enum(Website)).default([Website.JAVDB, Website.DMM]),
  trailer_url: z.array(z.enum(Website)).default([Website.DMM_TV, Website.DMM, Website.JAVBUS]),
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
    if (data.behavior.successFileMove && !data.naming.folderTemplate.includes("{number}")) {
      ctx.addIssue({
        code: "custom",
        path: ["naming", "folderTemplate"],
        message: "开启成功后移动文件时，文件夹模板必须包含 {number}",
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

import { z } from "zod";
import { normalizeActorAliasMap, normalizeActorName, toTrimmedActorName } from "./actorAliases";
import { ACTOR_IMAGE_SOURCE_OPTIONS, ACTOR_OVERVIEW_SOURCE_OPTIONS } from "./actorSource";
import { ASSET_NAMING_MODES } from "./assetNaming";
import { ProxyType, ThemeMode, TRANSLATION_TARGET_OPTIONS, TranslateEngine, Website } from "./enums";
import {
  DEFAULT_LLM_BASE_URL,
  LLM_API_FORMAT_OPTIONS,
  LLM_OUTPUT_FORMAT_OPTIONS,
  LLM_REASONING_OPTIONS,
  LLM_SERVICE_TYPE_OPTIONS,
} from "./llm";
import { localPathStyle } from "./localPath";
import {
  DEFAULT_POSTER_TAG_BADGE_TYPES,
  POSTER_TAG_BADGE_POSITION_OPTIONS,
  POSTER_TAG_BADGE_TYPE_OPTIONS,
} from "./posterBadges";
import { DEFAULT_R18_METADATA_LANGUAGE, R18_METADATA_LANGUAGE_OPTIONS } from "./r18";

const DEFAULT_SITES: Website[] = [
  Website.DMM,
  Website.DMM_TV,
  Website.MGSTAGE,
  Website.PRESTIGE,
  Website.FALENO,
  Website.DAHLIA,
  Website.FC2,
  Website.FC2HUB,
  Website.PPVDATABANK,
  Website.JAVDB,
  Website.JAVBUS,
  Website.JAV321,
  Website.KM_PRODUCE,
  Website.AVBASE,
  Website.OFFICIAL,
  Website.ONEPONDO,
  Website.TENMUSUME,
  Website.CARIBBEANCOM,
  Website.HEYZO,
  Website.R18_DEV,
];

const PART_STYLE_OPTIONS = ["RAW", "CD", "PART", "DISC"] as const;
const NFO_NAMING_OPTIONS = ["both", "movie", "filename"] as const;
export const NFO_FIELD_OPTIONS = [
  "num",
  "plot",
  "outline",
  "release",
  "runtime",
  "fileinfo",
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
  "sourceComment",
] as const;
export type NfoField = (typeof NFO_FIELD_OPTIONS)[number];

export const BAIDU_SERVICE_OPTIONS = ["general", "llm"] as const;
export const TRANSLATION_FIELD_OPTIONS = ["title", "plot", "genres"] as const;
export type TranslationField = (typeof TRANSLATION_FIELD_OPTIONS)[number];

export const mirrorUrlSchema = z
  .url({ protocol: /^https?$/u })
  .or(z.literal(""))
  .default("");

const networkSchema = z.object({
  proxyType: z.enum(ProxyType).default(ProxyType.NONE),
  proxy: z.string().default(""),
  useProxy: z.boolean().default(false),
  /** Sites that connect directly while the proxy is on. */
  directSites: z.array(z.enum(Website)).default([]),
  timeout: z.number().int().min(1).max(300).default(10),
  retryCount: z.number().int().min(0).max(10).default(3),
  javdbUrl: mirrorUrlSchema,
  javbusUrl: mirrorUrlSchema,
  javdbCookie: z.string().default(""),
  javbusCookie: z.string().default(""),
  fantiaCookie: z.string().default(""),
});

const scrapeSchema = z.object({
  sites: z.array(z.enum(Website)).default(DEFAULT_SITES),
  filenameIgnoreTokens: z.array(z.string()).default([]),
  filenameBlacklistTokens: z.array(z.string()).default([]),
  minVideoSizeMb: z.number().int().min(0).max(10240).default(0),
  r18MetadataLanguage: z.enum(R18_METADATA_LANGUAGE_OPTIONS).default(DEFAULT_R18_METADATA_LANGUAGE),
  threadNumber: z.number().int().min(1).max(128).default(2),
  javdbDelaySeconds: z.number().int().min(0).max(120).default(3),
  restAfterCount: z.number().int().min(1).max(500).default(20),
  restDuration: z.number().int().min(0).default(60),
  /** Filename keyword -> number, for files whose names no parser rule can read; saved from repairs. */
  numberMappings: z.record(z.string(), z.string().trim().min(1)).default({}),
});

const namingSchema = z.object({
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
  fields: z.array(z.enum(TRANSLATION_FIELD_OPTIONS)).default(() => [...TRANSLATION_FIELD_OPTIONS]),
  engine: z.enum(TranslateEngine).default(TranslateEngine.OPENAI),
  deeplApiKey: z.string().default(""),
  baiduService: z.enum(BAIDU_SERVICE_OPTIONS).default("general"),
  baiduAppId: z.string().default(""),
  baiduSecretKey: z.string().default(""),
  baiduApiKey: z.string().default(""),
  llmModelName: z.string().default("gpt-5.2"),
  llmApiKey: z.string().default(""),
  llmBaseUrl: z.url().or(z.literal("")).default(DEFAULT_LLM_BASE_URL),
  llmApiFormat: z.enum(LLM_API_FORMAT_OPTIONS).default("responses"),
  llmServiceType: z.enum(LLM_SERVICE_TYPE_OPTIONS).default("openai-compatible"),
  llmPrompt: z.string().default("自动识别原文语言，将以下内容翻译为{lang}。只输出最终翻译结果。\\n{content}"),
  llmTemperature: z.number().min(0).max(2).nullable().default(null),
  llmReasoning: z.enum(LLM_REASONING_OPTIONS).default("default"),
  llmOutputFormat: z.enum(LLM_OUTPUT_FORMAT_OPTIONS).default("none"),
  llmTimeout: z.number().int().min(1).max(300).default(120),
  llmMaxRetries: z.number().int().min(1).max(20).default(3),
  llmMaxRequestsPerSecond: z.number().int().min(1).max(100).default(1),
  targetLanguage: translationTargetSchema,
});

const downloadSchema = z.object({
  downloadThumb: z.boolean().default(true),
  downloadPoster: z.boolean().default(true),
  tagBadges: z.boolean().default(false),
  tagBadgeTypes: z.array(z.enum(POSTER_TAG_BADGE_TYPE_OPTIONS)).default(() => [...DEFAULT_POSTER_TAG_BADGE_TYPES]),
  tagBadgePosition: z.enum(POSTER_TAG_BADGE_POSITION_OPTIONS).default("topLeft"),
  tagBadgeImageOverrides: z.boolean().default(false),
  downloadFanart: z.boolean().default(true),
  downloadSceneImages: z.boolean().default(true),
  downloadTrailer: z.boolean().default(true),
  generateNfo: z.boolean().default(true),
  nfoNaming: z.enum(NFO_NAMING_OPTIONS).default("both"),
  nfoIgnoreFields: z.array(z.enum(NFO_FIELD_OPTIONS)).default([]),
  sceneImageConcurrency: z.number().int().min(1).max(20).default(5),
  keepThumb: z.boolean().default(true),
  keepPoster: z.boolean().default(true),
  keepFanart: z.boolean().default(true),
  keepSceneImages: z.boolean().default(true),
  keepTrailer: z.boolean().default(true),
});

/** Custom issue messages are codes so the UI can localize them. */
export type ConfigIssueCode =
  | "actorAliasListEmpty"
  | "actorCanonicalNameEmpty"
  | "actorAliasListNoValidAlias"
  | "actorAliasEmpty"
  | "actorAliasConflict"
  | "globalTimeoutNotGreater"
  | "actorPhotoFolderNotAbsolute"
  | "jellyfinUserIdNotUuid";

const actorAliasesSchema = z
  .record(z.string(), z.array(z.string()).min(1, "actorAliasListEmpty" satisfies ConfigIssueCode))
  .default({})
  .superRefine((actorAliases, ctx) => {
    const owners = new Map<string, { canonicalName: string; rawCanonicalName: string }>();

    for (const [rawCanonicalName, rawAliases] of Object.entries(actorAliases)) {
      const canonicalName = toTrimmedActorName(rawCanonicalName);
      if (!canonicalName) {
        ctx.addIssue({
          code: "custom",
          path: [rawCanonicalName],
          message: "actorCanonicalNameEmpty" satisfies ConfigIssueCode,
        });
        continue;
      }

      if (
        !rawAliases.some((alias) => {
          const normalizedAlias = toTrimmedActorName(alias);
          return normalizedAlias && normalizeActorName(normalizedAlias) !== normalizeActorName(canonicalName);
        })
      ) {
        ctx.addIssue({
          code: "custom",
          path: [rawCanonicalName],
          message: "actorAliasListNoValidAlias" satisfies ConfigIssueCode,
        });
      }

      const names = [canonicalName, ...rawAliases];
      for (const [index, rawName] of names.entries()) {
        const name = toTrimmedActorName(rawName);
        const path = index === 0 ? [rawCanonicalName] : [rawCanonicalName, index - 1];
        if (!name) {
          if (index > 0) {
            ctx.addIssue({ code: "custom", path, message: "actorAliasEmpty" satisfies ConfigIssueCode });
          }
          continue;
        }

        const normalizedName = normalizeActorName(name);
        const owner = owners.get(normalizedName);
        if (owner && (owner.canonicalName !== canonicalName || owner.rawCanonicalName !== rawCanonicalName)) {
          ctx.addIssue({
            code: "custom",
            path,
            message: "actorAliasConflict" satisfies ConfigIssueCode,
          });
          continue;
        }
        owners.set(normalizedName, { canonicalName, rawCanonicalName });
      }
    }
  })
  .transform((actorAliases) => normalizeActorAliasMap(actorAliases));

const personSyncSchema = z.object({
  personOverviewSources: z.array(z.enum(ACTOR_OVERVIEW_SOURCE_OPTIONS)).default(["official", "avjoho", "avbase"]),
  personImageSources: z.array(z.enum(ACTOR_IMAGE_SOURCE_OPTIONS)).default(["local", "gfriends", "official", "avbase"]),
  actorAliases: actorAliasesSchema,
});

const jellyfinSchema = z.object({
  url: z.url().or(z.literal("")).default("http://127.0.0.1:8096"),
  apiKey: z.string().default(""),
  userId: z.string().default(""),
  refreshPersonAfterSync: z.boolean().default(true),
  lockOverviewAfterSync: z.boolean().default(false),
  /** Asks the server to scan only the published directory, so new movies show up without a library refresh. */
  notifyAfterPublish: z.boolean().default(true),
});

const embySchema = z.object({
  url: z.url().or(z.literal("")).default(""),
  apiKey: z.string().default(""),
  userId: z.string().default(""),
  refreshPersonAfterSync: z.boolean().default(true),
  notifyAfterPublish: z.boolean().default(true),
});

const shortcutsSchema = z.object({
  startOrStopScrape: z.string().default("S"),
  retryScrape: z.string().default("R"),
  openFolder: z.string().default("F"),
  editNfo: z.string().default("E"),
  playVideo: z.string().default("P"),
});

const uiSchema = z.object({
  theme: z.enum(ThemeMode).default(ThemeMode.SYSTEM),
  showLogsPanel: z.boolean().default(true),
  hideDock: z.boolean().default(false),
  hideMenu: z.boolean().default(false),
  hideWindowButtons: z.boolean().default(false),
  useCustomTitleBar: z.boolean().default(true),
});

const pathsSchema = z.object({
  actorPhotoFolder: z.string().default(""),
  defaultScanExcludeDirs: z.array(z.string()).default([]),
  sceneImagesFolder: z.string().default("extrafanart"),
  configDirectory: z.string().default("config"),
  outputSummaryPath: z.string().default(""),
});

const behaviorSchema = z.object({
  updateCheck: z.boolean().default(true),
});

/** Downloader paths are translated before matching library roots, as with *arr remote path mappings. */
const pathMappingSchema = z.object({
  from: z.string().trim().min(1),
  to: z.string().trim().min(1),
});

const automationSchema = z.object({
  pathMappings: z.array(pathMappingSchema).default([]),
});

export const NOTIFICATION_CHANNELS = ["telegram", "bark", "ntfy"] as const;

const notificationsSchema = z.object({
  /** Receives every task start and finish as JSON. */
  webhookUrl: z
    .url({ protocol: /^https?$/u })
    .or(z.literal(""))
    .default(""),
  webhookSecret: z.string().default(""),
  /** Human-readable messages when an unattended scrape finishes, plus the optional daily digest. */
  channels: z.array(z.enum(NOTIFICATION_CHANNELS)).default([]),
  telegramBotToken: z.string().default(""),
  telegramChatId: z.string().default(""),
  barkUrl: z
    .url({ protocol: /^https?$/u })
    .or(z.literal(""))
    .default(""),
  ntfyUrl: z
    .url({ protocol: /^https?$/u })
    .or(z.literal(""))
    .default(""),
  ntfyToken: z.string().default(""),
  dailyDigest: z.boolean().default(false),
  digestHour: z.number().int().min(0).max(23).default(9),
});

const titleRepairSchema = z.object({
  enabled: z.boolean().default(false),
  stripTrailingActors: z.boolean().default(false),
});

// Maker sites answer only their own numbers, so leading the text fields costs nothing elsewhere; their titles carry no
// appended actor names and their plots are unmasked.
const MAKER_TEXT_SITES = [
  Website.OFFICIAL,
  Website.ONEPONDO,
  Website.TENMUSUME,
  Website.CARIBBEANCOM,
  Website.HEYZO,
  Website.DAHLIA,
  Website.FALENO,
  Website.PRESTIGE,
  Website.KM_PRODUCE,
];

const fieldPrioritiesSchema = z.object({
  title: z
    .array(z.enum(Website))
    .default([
      ...MAKER_TEXT_SITES,
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
      ...MAKER_TEXT_SITES,
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
        message: "globalTimeoutNotGreater" satisfies ConfigIssueCode,
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
    automation: automationSchema.default(() => automationSchema.parse({})),
    notifications: notificationsSchema.default(() => notificationsSchema.parse({})),
    titleRepair: titleRepairSchema.default(() => titleRepairSchema.parse({})),
    aggregation: aggregationSchema.default(() => aggregationSchema.parse({})),
  })
  .superRefine((data, ctx) => {
    if (data.paths.actorPhotoFolder.trim() && !localPathStyle(data.paths.actorPhotoFolder.trim()))
      ctx.addIssue({
        code: "custom",
        path: ["paths", "actorPhotoFolder"],
        message: "actorPhotoFolderNotAbsolute" satisfies ConfigIssueCode,
      });

    if (
      data.jellyfin.userId.trim().length > 0 &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(data.jellyfin.userId.trim())
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["jellyfin", "userId"],
        message: "jellyfinUserIdNotUuid" satisfies ConfigIssueCode,
      });
    }
  });

export type Configuration = z.infer<typeof configurationSchema>;

export const OFFICIAL_SITE_URLS = {
  [Website.JAVDB]: "https://javdb.com",
  [Website.JAVBUS]: "https://www.javbus.com",
} as const;

export type MirrorableSite = keyof typeof OFFICIAL_SITE_URLS;
export type SiteUrlConfiguration = Pick<Configuration["network"], "javdbUrl" | "javbusUrl">;

export const OFFICIAL_SITE_HOSTS = {
  [Website.JAVDB]: ["javdb.com", "www.javdb.com"],
  [Website.JAVBUS]: ["www.javbus.com", "javbus.com"],
} as const satisfies Record<MirrorableSite, readonly string[]>;

const MIRROR_URL_KEYS = {
  [Website.JAVDB]: "javdbUrl",
  [Website.JAVBUS]: "javbusUrl",
} as const satisfies Record<MirrorableSite, keyof SiteUrlConfiguration>;

export const isMirrorableSite = (site: Website): site is MirrorableSite => site in OFFICIAL_SITE_URLS;

// Mirrors serve the same paths as the official site, so only the configured origin is used.
export const resolveSiteUrl = (network: SiteUrlConfiguration, site: MirrorableSite): string => {
  const configured = network[MIRROR_URL_KEYS[site]];
  return configured ? new URL(configured).origin : OFFICIAL_SITE_URLS[site];
};

export type DeepPartial<T> =
  T extends Array<infer U> ? Array<DeepPartial<U>> : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

export const defaultConfiguration: Configuration = configurationSchema.parse({});

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

  return { found: false };
}

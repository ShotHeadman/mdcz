/**
 * Configuration migration definitions.
 *
 * Each migration transforms a raw config object from one version to the next.
 * Migrations must be pure data transforms — no I/O, no side effects.
 *
 * When releasing a new stable version, old migrations can be removed once all
 * users have upgraded past the corresponding configVersion.
 */

export interface Migration {
  fromVersion: number;
  toVersion: number;
  description: string;
  migrate: (raw: Record<string, unknown>) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((e) => typeof e === "string");

const stringArraysEqual = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

/** Rename a key inside a nested section. */
const renameKey = (raw: Record<string, unknown>, section: string, oldKey: string, newKey: string): void => {
  const obj = raw[section];
  if (!isRecord(obj) || !(oldKey in obj)) return;
  if (!(newKey in obj)) {
    obj[newKey] = obj[oldKey];
  }
  delete obj[oldKey];
};

const DEFAULT_FOLDER_TEMPLATE = "{actor}/{number}";
const V0_ENABLED_SITES = [
  "dmm",
  "dmm_tv",
  "mgstage",
  "prestige",
  "faleno",
  "dahlia",
  "fc2",
  "javdb",
  "javbus",
  "jav321",
  "km_produce",
] as const;
const V1_ENABLED_SITES = [...V0_ENABLED_SITES, "avbase"] as const;
const V2_ENABLED_SITES = [...V1_ENABLED_SITES, "fc2hub"] as const;

const V0_FIELD_PRIORITY_DEFAULTS: Record<string, readonly string[]> = {
  title: ["dmm", "mgstage", "dmm_tv", "fc2", "javdb", "javbus", "jav321", "km_produce"],
  plot: ["mgstage", "dmm", "dmm_tv", "fc2", "jav321"],
  actors: ["javdb", "dmm", "javbus", "mgstage", "km_produce"],
  genres: ["javdb", "fc2", "dmm", "javbus", "km_produce"],
  thumb_url: ["dmm", "fc2", "javdb", "javbus", "km_produce"],
  poster_url: ["dmm", "fc2", "javdb", "javbus", "km_produce"],
  sample_images: ["mgstage", "dmm", "javbus", "javdb"],
  studio: ["dmm", "fc2", "javdb", "javbus", "km_produce"],
  director: ["dmm", "javdb"],
  publisher: ["dmm", "fc2", "javdb"],
  series: ["dmm", "javdb", "javbus"],
  release_date: ["dmm", "fc2", "javdb", "javbus", "km_produce"],
  rating: ["javdb", "dmm"],
};

const V1_FIELD_PRIORITY_DEFAULTS: Record<string, readonly string[]> = {
  title: ["avbase", "mgstage", "dmm", "dmm_tv", "javdb", "javbus", "jav321", "fc2"],
  plot: ["avbase", "mgstage", "dmm", "dmm_tv", "jav321", "fc2"],
  actors: ["avbase", "mgstage", "dmm", "javdb", "javbus"],
  genres: ["avbase", "dmm", "javdb", "javbus", "fc2"],
  thumb_url: ["avbase", "mgstage", "dmm", "javdb", "javbus", "fc2"],
  poster_url: ["avbase", "mgstage", "dmm", "javdb", "javbus", "fc2"],
  sample_images: ["avbase", "mgstage", "dmm", "javdb", "javbus"],
  studio: ["avbase", "dmm", "javdb", "javbus", "fc2"],
  director: ["avbase", "dmm", "javdb"],
  publisher: ["avbase", "dmm", "javdb", "fc2"],
  series: ["avbase", "dmm", "javdb", "javbus"],
  release_date: ["avbase", "dmm", "javdb", "javbus", "fc2"],
  durationSeconds: ["avbase", "dmm_tv"],
  rating: ["dmm_tv", "dmm", "javdb"],
  trailer_url: ["dmm_tv", "dmm", "javbus"],
};

const V2_FIELD_PRIORITY_DEFAULTS: Record<string, readonly string[]> = {
  title: ["avbase", "mgstage", "dmm", "dmm_tv", "fc2", "fc2hub", "javdb", "javbus", "jav321"],
  plot: ["avbase", "mgstage", "dmm", "dmm_tv", "fc2", "fc2hub", "jav321"],
  actors: ["avbase", "mgstage", "dmm", "fc2hub", "javdb", "javbus"],
  genres: ["avbase", "dmm", "fc2", "fc2hub", "javdb", "javbus"],
  thumb_url: ["avbase", "mgstage", "dmm", "fc2", "fc2hub", "javdb", "javbus"],
  poster_url: ["avbase", "mgstage", "dmm", "fc2", "fc2hub", "javdb", "javbus"],
  scene_images: ["avbase", "mgstage", "dmm", "fc2", "fc2hub", "javdb", "javbus"],
  studio: ["avbase", "dmm", "fc2", "fc2hub", "javdb", "javbus"],
  director: ["avbase", "dmm", "javdb"],
  publisher: ["avbase", "dmm", "fc2", "fc2hub", "javdb"],
  series: ["avbase", "dmm", "javdb", "javbus"],
  release_date: ["avbase", "dmm", "fc2", "fc2hub", "javdb", "javbus"],
  durationSeconds: ["avbase", "dmm_tv", "fc2hub"],
  rating: ["dmm_tv", "dmm", "fc2hub", "javdb"],
  trailer_url: ["dmm_tv", "dmm", "javbus"],
};
const V3_FIELD_PRIORITY_DEFAULTS: Record<string, readonly string[]> = {
  ...V2_FIELD_PRIORITY_DEFAULTS,
  title: ["avbase", "mgstage", "dmm", "dmm_tv", "fc2hub", "fc2", "javdb", "javbus", "jav321"],
};
const V050_LEGACY_TRANSLATE_PROMPT = "请将以下文本翻译成{lang}。只输出翻译结果。\\n{content}";
const V052_DEFAULT_TRANSLATE_PROMPT =
  "你是一个影片元数据翻译引擎。自动识别原文语言，将以下内容翻译为{lang}。只输出最终翻译结果，不要输出任何解释。\\n{content}";

const appendPathSegment = (template: string, segment: string): string => {
  const trimmed = template.trim();
  if (!trimmed) {
    return DEFAULT_FOLDER_TEMPLATE;
  }
  if (trimmed.endsWith("/")) {
    return `${trimmed}${segment}`;
  }
  return `${trimmed}/${segment}`;
};

const migrateFolderTemplate = (raw: Record<string, unknown>): void => {
  const successFileMove =
    !isRecord(raw.behavior) || !("successFileMove" in raw.behavior) ? true : raw.behavior.successFileMove !== false;
  if (!successFileMove) {
    return;
  }

  const naming = raw.naming;
  if (!isRecord(naming) || !("folderTemplate" in naming)) {
    return;
  }

  const folderTemplate = naming.folderTemplate;
  if (typeof folderTemplate !== "string" || folderTemplate.trim() === "") {
    naming.folderTemplate = DEFAULT_FOLDER_TEMPLATE;
    return;
  }

  if (!folderTemplate.includes("{number}")) {
    naming.folderTemplate = appendPathSegment(folderTemplate, "{number}");
  }
};

const normalizeScrapeSiteDefaults = (
  raw: Record<string, unknown>,
  previousDefaults: readonly string[],
  nextDefaults: readonly string[],
): void => {
  const scrape = raw.scrape;
  if (!isRecord(scrape)) {
    return;
  }

  if (isStringArray(scrape.enabledSites) && stringArraysEqual(scrape.enabledSites, previousDefaults)) {
    scrape.enabledSites = [...nextDefaults];
  }

  if (isStringArray(scrape.siteOrder) && stringArraysEqual(scrape.siteOrder, previousDefaults)) {
    scrape.siteOrder = [...nextDefaults];
  }
};

const normalizeFieldPriorityDefaults = (
  raw: Record<string, unknown>,
  previousDefaults: Record<string, readonly string[]>,
  nextDefaults: Record<string, readonly string[]>,
): void => {
  const aggregation = raw.aggregation;
  if (!isRecord(aggregation)) {
    return;
  }

  const fieldPriorities = aggregation.fieldPriorities;
  if (!isRecord(fieldPriorities)) {
    return;
  }

  for (const [key, previousSites] of Object.entries(previousDefaults)) {
    const currentSites = nextDefaults[key];
    if (!currentSites) {
      continue;
    }
    const value = fieldPriorities[key];
    if (isStringArray(value) && stringArraysEqual(value, previousSites)) {
      fieldPriorities[key] = [...currentSites];
    }
  }
};

const normalizeRenamedFieldPriorityDefault = (
  raw: Record<string, unknown>,
  oldKey: string,
  newKey: string,
  previousSites: readonly string[],
  nextSites: readonly string[],
): void => {
  const aggregation = raw.aggregation;
  if (!isRecord(aggregation)) {
    return;
  }

  const fieldPriorities = aggregation.fieldPriorities;
  if (!isRecord(fieldPriorities)) {
    return;
  }

  const oldValue = fieldPriorities[oldKey];
  if (isStringArray(oldValue) && stringArraysEqual(oldValue, previousSites)) {
    fieldPriorities[newKey] = [...nextSites];
    delete fieldPriorities[oldKey];
    return;
  }

  renameKey(aggregation, "fieldPriorities", oldKey, newKey);

  const newValue = fieldPriorities[newKey];
  if (isStringArray(newValue) && stringArraysEqual(newValue, previousSites)) {
    fieldPriorities[newKey] = [...nextSites];
  }
};

// ── v0.3.0 → v0.4.0 ─────────────────────────────────────────────────────────

function migrateV030ToV040(raw: Record<string, unknown>): void {
  // 1. download.downloadCover → download.downloadThumb
  renameKey(raw, "download", "downloadCover", "downloadThumb");

  // 2. download.keepCover → download.keepThumb
  renameKey(raw, "download", "keepCover", "keepThumb");

  // 3. server → emby (url, apiKey, userId)
  const server = raw.server;
  if (isRecord(server)) {
    if (!isRecord(raw.emby)) raw.emby = {};
    const emby = raw.emby as Record<string, unknown>;

    for (const key of ["url", "apiKey", "userId"]) {
      if (key in server && !(key in emby)) {
        emby[key] = server[key];
      }
    }

    // 4. server.actorPhotoFolder → paths.actorPhotoFolder
    if (!isRecord(raw.paths)) raw.paths = {};
    const paths = raw.paths as Record<string, unknown>;
    if ("actorPhotoFolder" in server) {
      if (!("actorPhotoFolder" in paths)) {
        const value = server.actorPhotoFolder;
        paths.actorPhotoFolder = typeof value === "string" && value.trim() !== "" ? value : "actor_photo";
      }
    }

    delete raw.server;
  }

  // 5. aggregation.fieldPriorities.cover_url → .thumb_url
  const aggregation = raw.aggregation;
  if (isRecord(aggregation)) {
    renameKey(aggregation, "fieldPriorities", "cover_url", "thumb_url");
  }

  // 6. paths.sceneImagesFolder: "samples" → "extrafanart"
  const paths = raw.paths;
  if (isRecord(paths) && paths.sceneImagesFolder === "samples") {
    paths.sceneImagesFolder = "extrafanart";
  }

  // 7. Ensure folderTemplate stays valid under the new successFileMove rule
  migrateFolderTemplate(raw);

  // 8. Normalize untouched legacy enabledSites / siteOrder arrays to the current defaults
  normalizeScrapeSiteDefaults(raw, V0_ENABLED_SITES, V1_ENABLED_SITES);

  // 9. Normalize untouched legacy fieldPriorities arrays to the current v0.4 defaults
  normalizeFieldPriorityDefaults(raw, V0_FIELD_PRIORITY_DEFAULTS, V1_FIELD_PRIORITY_DEFAULTS);
}

// ── v0.4.0 → v0.5.0 ─────────────────────────────────────────────────────────

function migrateV040ToV050(raw: Record<string, unknown>): void {
  // 1. download.downloadNfo → download.generateNfo
  renameKey(raw, "download", "downloadNfo", "generateNfo");

  // 2. aggregation.fieldPriorities.sample_images → .scene_images
  normalizeRenamedFieldPriorityDefault(
    raw,
    "sample_images",
    "scene_images",
    V1_FIELD_PRIORITY_DEFAULTS.sample_images,
    V2_FIELD_PRIORITY_DEFAULTS.scene_images,
  );

  // 3. Normalize untouched v0.4 enabledSites / siteOrder arrays to the v0.5 defaults
  normalizeScrapeSiteDefaults(raw, V1_ENABLED_SITES, V2_ENABLED_SITES);

  // 4. Normalize untouched v0.4 fieldPriorities arrays to the v0.5 defaults
  normalizeFieldPriorityDefaults(raw, V1_FIELD_PRIORITY_DEFAULTS, V2_FIELD_PRIORITY_DEFAULTS);

  // 5. Rename multipart style values to the current uppercase enum and default to RAW
  const naming = raw.naming;
  if (isRecord(naming)) {
    const currentPartStyle = naming.partStyle;
    if (typeof currentPartStyle === "string") {
      switch (currentPartStyle.toLowerCase()) {
        case "cd":
          naming.partStyle = "CD";
          break;
        case "part":
          naming.partStyle = "PART";
          break;
        case "disc":
          naming.partStyle = "DISC";
          break;
        default:
          naming.partStyle = "RAW";
          break;
      }
    } else {
      naming.partStyle = "RAW";
    }
  }
}

// ── v0.5.0 → v0.5.2 ─────────────────────────────────────────────────────────

function migrateV050ToV052(raw: Record<string, unknown>): void {
  // 1. translate.llmMaxTry → translate.llmMaxRetries
  renameKey(raw, "translate", "llmMaxTry", "llmMaxRetries");

  // 2. translate.titleLanguage + plotLanguage → targetLanguage (keep titleLanguage value)
  const translate = raw.translate;
  if (isRecord(translate)) {
    if ("titleLanguage" in translate && !("targetLanguage" in translate)) {
      translate.targetLanguage = translate.titleLanguage;
    }

    // 3. Upgrade untouched legacy prompt to the new default prompt
    if (translate.llmPrompt === V050_LEGACY_TRANSLATE_PROMPT) {
      translate.llmPrompt = V052_DEFAULT_TRANSLATE_PROMPT;
    }

    delete translate.titleLanguage;
    delete translate.plotLanguage;

    // 4. Remove enableGoogleFallback (no longer used)
    delete translate.enableGoogleFallback;
  }

  // 5. Normalize untouched v0.5 fieldPriorities arrays to the current defaults
  normalizeFieldPriorityDefaults(raw, V2_FIELD_PRIORITY_DEFAULTS, V3_FIELD_PRIORITY_DEFAULTS);
}

// ── Registry ─────────────────────────────────────────────────────────────────

export const migrations: Migration[] = [
  {
    fromVersion: 0,
    toVersion: 1,
    description: "v0.3.0 → v0.4.0",
    migrate: migrateV030ToV040,
  },
  {
    fromVersion: 1,
    toVersion: 2,
    description: "v0.4.0 → v0.5.0",
    migrate: migrateV040ToV050,
  },
  {
    fromVersion: 2,
    toVersion: 3,
    description: "v0.5.0 → v0.5.2",
    migrate: migrateV050ToV052,
  },
];

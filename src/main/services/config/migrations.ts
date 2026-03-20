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
const V2_ENABLED_SITES = [...V0_ENABLED_SITES.slice(0, 7), "fc2hub", ...V0_ENABLED_SITES.slice(7), "avbase"] as const;

const V0_FIELD_PRIORITY_DEFAULTS: Record<string, readonly string[]> = {
  title: ["dmm", "mgstage", "dmm_tv", "fc2", "javdb", "javbus", "jav321", "km_produce"],
  plot: ["mgstage", "dmm", "dmm_tv", "fc2", "jav321"],
  actors: ["javdb", "dmm", "javbus", "mgstage", "km_produce"],
  genres: ["javdb", "fc2", "dmm", "javbus", "km_produce"],
  thumb_url: ["dmm", "fc2", "javdb", "javbus", "km_produce"],
  poster_url: ["dmm", "fc2", "javdb", "javbus", "km_produce"],
  scene_images: ["mgstage", "dmm", "javbus", "javdb"],
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
  scene_images: ["avbase", "mgstage", "dmm", "javdb", "javbus"],
  studio: ["avbase", "dmm", "javdb", "javbus", "fc2"],
  director: ["avbase", "dmm", "javdb"],
  publisher: ["avbase", "dmm", "javdb", "fc2"],
  series: ["avbase", "dmm", "javdb", "javbus"],
  release_date: ["avbase", "dmm", "javdb", "javbus", "fc2"],
  rating: ["dmm_tv", "dmm", "javdb"],
};

const V2_FIELD_PRIORITY_DEFAULTS: Record<string, readonly string[]> = {
  ...V1_FIELD_PRIORITY_DEFAULTS,
  actors: ["avbase", "mgstage", "dmm", "fc2hub", "javdb", "javbus"],
  thumb_url: ["avbase", "mgstage", "dmm", "fc2", "fc2hub", "javdb", "javbus"],
  poster_url: ["avbase", "mgstage", "dmm", "fc2", "fc2hub", "javdb", "javbus"],
  scene_images: ["avbase", "mgstage", "dmm", "fc2hub", "javdb", "javbus"],
  release_date: ["avbase", "dmm", "fc2", "fc2hub", "javdb", "javbus"],
};

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
    const value = fieldPriorities[key];
    if (isStringArray(value) && stringArraysEqual(value, previousSites)) {
      fieldPriorities[key] = [...currentSites];
    }
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

// ── v0.4.0 → v0.4.1 ─────────────────────────────────────────────────────────

function migrateV040ToV041(raw: Record<string, unknown>): void {
  normalizeScrapeSiteDefaults(raw, V1_ENABLED_SITES, V2_ENABLED_SITES);
  normalizeFieldPriorityDefaults(raw, V1_FIELD_PRIORITY_DEFAULTS, V2_FIELD_PRIORITY_DEFAULTS);
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
    description: "v0.4.0 → v0.4.1",
    migrate: migrateV040ToV041,
  },
];

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
const V040_PERSON_OVERVIEW_SOURCE_OPTIONS = ["official", "avjoho", "avbase"] as const;
const V040_PERSON_IMAGE_SOURCE_OPTIONS = ["local", "official", "gfriends", "avbase"] as const;

const LEGACY_FIELD_PRIORITY_DEFAULTS: Record<string, readonly string[]> = {
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

const CURRENT_FIELD_PRIORITY_DEFAULTS: Record<string, readonly string[]> = {
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
  rating: ["dmm_tv", "dmm", "javdb"],
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

const sanitizePersonSyncSources = (raw: Record<string, unknown>): void => {
  const personSync = raw.personSync;
  if (!isRecord(personSync)) {
    return;
  }

  if (Array.isArray(personSync.personImageSources)) {
    personSync.personImageSources = personSync.personImageSources.filter(
      (value): value is string =>
        typeof value === "string" &&
        V040_PERSON_IMAGE_SOURCE_OPTIONS.includes(value as (typeof V040_PERSON_IMAGE_SOURCE_OPTIONS)[number]),
    );
  }

  if (Array.isArray(personSync.personOverviewSources)) {
    personSync.personOverviewSources = personSync.personOverviewSources.filter(
      (value): value is string =>
        typeof value === "string" &&
        V040_PERSON_OVERVIEW_SOURCE_OPTIONS.includes(value as (typeof V040_PERSON_OVERVIEW_SOURCE_OPTIONS)[number]),
    );
  }
};

const normalizeFieldPriorityDefaults = (raw: Record<string, unknown>): void => {
  const aggregation = raw.aggregation;
  if (!isRecord(aggregation)) {
    return;
  }

  const fieldPriorities = aggregation.fieldPriorities;
  if (!isRecord(fieldPriorities)) {
    return;
  }

  for (const [key, legacySites] of Object.entries(LEGACY_FIELD_PRIORITY_DEFAULTS)) {
    const currentSites = CURRENT_FIELD_PRIORITY_DEFAULTS[key];
    const value = fieldPriorities[key];
    if (isStringArray(value) && stringArraysEqual(value, legacySites)) {
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
    const fieldPriorities = aggregation.fieldPriorities;
    if (isRecord(fieldPriorities)) {
      delete fieldPriorities.actor_profiles;
    }
  }

  // 6. paths.sceneImagesFolder: "samples" → "extrafanart"
  const paths = raw.paths;
  if (isRecord(paths) && paths.sceneImagesFolder === "samples") {
    paths.sceneImagesFolder = "extrafanart";
  }

  // 7. Ensure folderTemplate stays valid under the new successFileMove rule
  migrateFolderTemplate(raw);

  // 8. Sanitize legacy personSync source arrays against the v0.4 option snapshot
  sanitizePersonSyncSources(raw);

  // 9. Append the newly introduced default site to enabledSites / siteOrder
  const scrape = raw.scrape;
  if (isRecord(scrape)) {
    if (isStringArray(scrape.enabledSites)) {
      for (const site of ["avbase"]) {
        if (!scrape.enabledSites.includes(site)) {
          scrape.enabledSites.push(site);
        }
      }
    }
    if (isStringArray(scrape.siteOrder)) {
      for (const site of ["avbase"]) {
        if (!scrape.siteOrder.includes(site)) {
          scrape.siteOrder.push(site);
        }
      }
    }
  }

  // 10. Normalize untouched legacy fieldPriorities arrays to the current v0.4 defaults
  normalizeFieldPriorityDefaults(raw);
}

// ── Registry ─────────────────────────────────────────────────────────────────

export const migrations: Migration[] = [
  {
    fromVersion: 0,
    toVersion: 1,
    description: "v0.3.0 → v0.4.0",
    migrate: migrateV030ToV040,
  },
];

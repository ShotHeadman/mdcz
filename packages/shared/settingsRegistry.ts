export const SECTION_ORDER = ["paths", "scrape", "network", "translate", "naming", "download", "system"] as const;

export type FieldAnchor = (typeof SECTION_ORDER)[number];
export type FieldSurface = "settings" | "tools" | "about" | "internal";
export type FieldVisibility = "public" | "advanced" | "hidden";

export const AGGREGATION_PRIORITY_KEYS = [
  "aggregation.fieldPriorities.title",
  "aggregation.fieldPriorities.plot",
  "aggregation.fieldPriorities.actors",
  "aggregation.fieldPriorities.genres",
  "aggregation.fieldPriorities.thumb_url",
  "aggregation.fieldPriorities.poster_url",
  "aggregation.fieldPriorities.scene_images",
  "aggregation.fieldPriorities.studio",
  "aggregation.fieldPriorities.director",
  "aggregation.fieldPriorities.publisher",
  "aggregation.fieldPriorities.series",
  "aggregation.fieldPriorities.release_date",
  "aggregation.fieldPriorities.durationSeconds",
  "aggregation.fieldPriorities.rating",
  "aggregation.fieldPriorities.trailer_url",
] as const;

export type AggregationPriorityKey = (typeof AGGREGATION_PRIORITY_KEYS)[number];

const ADVANCED_FIELD_KEYS = new Set<string>([
  "download.sceneImageConcurrency",
  "aggregation.maxParallelCrawlers",
  "aggregation.perCrawlerTimeoutMs",
  "aggregation.globalTimeoutMs",
  "aggregation.behavior.preferLongerPlot",
  "aggregation.behavior.maxSceneImages",
  "aggregation.behavior.maxActors",
  "aggregation.behavior.maxGenres",
  ...AGGREGATION_PRIORITY_KEYS,
]);

interface RawFieldEntry {
  key: string;
  anchor: FieldAnchor;
  surface?: FieldSurface;
  visibility?: FieldVisibility;
}

const RAW_FIELD_REGISTRY = [
  { key: "paths.mediaPath", anchor: "paths" },
  { key: "paths.defaultScanExcludeDirs", anchor: "paths" },
  { key: "watch.enabled", anchor: "paths" },
  { key: "watch.intervalMinutes", anchor: "paths" },
  { key: "behavior.successFileMove", anchor: "paths" },
  { key: "paths.successOutputFolder", anchor: "paths" },
  { key: "behavior.successFileRename", anchor: "paths" },
  { key: "behavior.metadataOnly", anchor: "paths" },
  { key: "paths.metadataPath", anchor: "paths" },
  { key: "paths.actorPhotoFolder", anchor: "paths" },
  { key: "paths.sceneImagesFolder", anchor: "paths" },
  { key: "paths.outputSummaryPath", anchor: "paths" },
  { key: "paths.configDirectory", anchor: "paths" },
  { key: "scrape.sites", anchor: "scrape" },
  { key: "scrape.r18MetadataLanguage", anchor: "scrape", visibility: "hidden" },
  { key: "scrape.filenameIgnoreTokens", anchor: "scrape" },
  { key: "scrape.filenameBlacklistTokens", anchor: "scrape" },
  { key: "scrape.minVideoSizeMb", anchor: "scrape" },
  { key: "scrape.threadNumber", anchor: "scrape" },
  { key: "scrape.javdbDelaySeconds", anchor: "scrape" },
  { key: "scrape.restAfterCount", anchor: "scrape" },
  { key: "scrape.restDuration", anchor: "scrape" },
  { key: "network.proxyType", anchor: "network" },
  { key: "network.proxy", anchor: "network" },
  { key: "network.useProxy", anchor: "network" },
  { key: "network.timeout", anchor: "network" },
  { key: "network.retryCount", anchor: "network" },
  { key: "network.javdbUrl", anchor: "network" },
  { key: "network.javdbCookie", anchor: "network" },
  { key: "network.javbusUrl", anchor: "network" },
  { key: "network.javbusCookie", anchor: "network" },
  { key: "network.fantiaCookie", anchor: "network" },
  ...AGGREGATION_PRIORITY_KEYS.map((key) => ({ key, anchor: "scrape" as const })),
  { key: "aggregation.maxParallelCrawlers", anchor: "scrape" },
  { key: "aggregation.perCrawlerTimeoutMs", anchor: "scrape" },
  { key: "aggregation.globalTimeoutMs", anchor: "scrape" },
  { key: "download.downloadThumb", anchor: "download" },
  { key: "download.downloadPoster", anchor: "download" },
  { key: "download.tagBadges", anchor: "download" },
  { key: "download.tagBadgeTypes", anchor: "download" },
  { key: "download.tagBadgePosition", anchor: "download" },
  { key: "download.tagBadgeImageOverrides", anchor: "download" },
  { key: "download.downloadFanart", anchor: "download" },
  { key: "download.downloadSceneImages", anchor: "download" },
  { key: "download.downloadTrailer", anchor: "download" },
  { key: "download.sceneImageConcurrency", anchor: "download" },
  { key: "download.generateNfo", anchor: "download" },
  { key: "download.nfoNaming", anchor: "download" },
  { key: "download.nfoIgnoreFields", anchor: "download" },
  { key: "download.keepThumb", anchor: "download" },
  { key: "download.keepPoster", anchor: "download" },
  { key: "download.keepFanart", anchor: "download" },
  { key: "download.keepSceneImages", anchor: "download" },
  { key: "download.keepTrailer", anchor: "download" },
  { key: "download.keepNfo", anchor: "download" },
  { key: "naming.folderTemplate", anchor: "naming" },
  { key: "naming.fileTemplate", anchor: "naming" },
  { key: "titleRepair.enabled", anchor: "naming" },
  { key: "naming.assetNamingMode", anchor: "naming" },
  { key: "naming.nfoTitleTemplate", anchor: "naming" },
  { key: "naming.actorNameMax", anchor: "naming" },
  { key: "naming.actorNameMore", anchor: "naming" },
  { key: "naming.actorFallbackToStudio", anchor: "naming" },
  { key: "naming.releaseRule", anchor: "naming" },
  { key: "naming.folderNameMax", anchor: "naming" },
  { key: "naming.fileNameMax", anchor: "naming" },
  { key: "naming.cnwordStyle", anchor: "naming" },
  { key: "naming.umrStyle", anchor: "naming" },
  { key: "naming.leakStyle", anchor: "naming" },
  { key: "naming.uncensoredStyle", anchor: "naming" },
  { key: "naming.censoredStyle", anchor: "naming" },
  { key: "naming.partStyle", anchor: "naming" },
  { key: "aggregation.behavior.preferLongerPlot", anchor: "scrape" },
  { key: "aggregation.behavior.maxSceneImages", anchor: "scrape" },
  { key: "aggregation.behavior.maxActors", anchor: "scrape" },
  { key: "aggregation.behavior.maxGenres", anchor: "scrape" },
  { key: "translate.enableTranslation", anchor: "translate" },
  { key: "translate.engine", anchor: "translate" },
  { key: "translate.deeplApiKey", anchor: "translate" },
  { key: "translate.baiduService", anchor: "translate" },
  { key: "translate.baiduAppId", anchor: "translate" },
  { key: "translate.baiduSecretKey", anchor: "translate" },
  { key: "translate.baiduApiKey", anchor: "translate" },
  { key: "translate.llmModelName", anchor: "translate" },
  { key: "translate.llmApiKey", anchor: "translate" },
  { key: "translate.llmBaseUrl", anchor: "translate" },
  { key: "translate.llmApiFormat", anchor: "translate" },
  { key: "translate.llmServiceType", anchor: "translate" },
  { key: "translate.llmPrompt", anchor: "translate" },
  { key: "translate.llmTemperature", anchor: "translate" },
  { key: "translate.llmReasoning", anchor: "translate" },
  { key: "translate.llmOutputFormat", anchor: "translate" },
  { key: "translate.llmTimeout", anchor: "translate" },
  { key: "translate.llmMaxRetries", anchor: "translate" },
  { key: "translate.llmMaxRequestsPerSecond", anchor: "translate" },
  { key: "translate.targetLanguage", anchor: "translate" },
  { key: "personSync.personOverviewSources", anchor: "system", surface: "tools" },
  { key: "personSync.personImageSources", anchor: "system", surface: "tools" },
  { key: "jellyfin.url", anchor: "system", surface: "tools" },
  { key: "jellyfin.apiKey", anchor: "system", surface: "tools" },
  { key: "jellyfin.userId", anchor: "system", surface: "tools" },
  { key: "jellyfin.refreshPersonAfterSync", anchor: "system", surface: "tools" },
  { key: "jellyfin.lockOverviewAfterSync", anchor: "system", surface: "tools" },
  { key: "emby.url", anchor: "system", surface: "tools" },
  { key: "emby.apiKey", anchor: "system", surface: "tools" },
  { key: "emby.userId", anchor: "system", surface: "tools" },
  { key: "emby.refreshPersonAfterSync", anchor: "system", surface: "tools" },
  { key: "shortcuts.startOrStopScrape", anchor: "system" },
  { key: "shortcuts.retryScrape", anchor: "system" },
  { key: "shortcuts.openFolder", anchor: "system" },
  { key: "shortcuts.editNfo", anchor: "system" },
  { key: "shortcuts.playVideo", anchor: "system" },
  { key: "ui.showLogsPanel", anchor: "system" },
  { key: "ui.useCustomTitleBar", anchor: "system" },
  { key: "ui.hideDock", anchor: "system" },
  { key: "ui.hideMenu", anchor: "system" },
  { key: "ui.hideWindowButtons", anchor: "system" },
] as const satisfies readonly RawFieldEntry[];

/** Display text (labels, descriptions, search aliases) lives in the UI locale dictionaries, keyed by FieldKey. */
export type FieldKey = (typeof RAW_FIELD_REGISTRY)[number]["key"];

export interface FieldEntry {
  key: FieldKey;
  anchor: FieldAnchor;
  surface: FieldSurface;
  visibility: FieldVisibility;
}

export const FIELD_REGISTRY: FieldEntry[] = RAW_FIELD_REGISTRY.map((entry: RawFieldEntry & { key: FieldKey }) => ({
  key: entry.key,
  anchor: entry.anchor,
  surface: entry.surface ?? "settings",
  visibility: entry.visibility ?? (ADVANCED_FIELD_KEYS.has(entry.key) ? "advanced" : "public"),
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
  FieldKey,
  FieldEntry
>;

export const SETTINGS_FIELD_REGISTRY = FIELD_REGISTRY.filter((entry) => entry.surface === "settings");

export function isFieldManagedBySettingsSearch(key: string): boolean {
  return FIELD_REGISTRY_BY_KEY[key as FieldKey]?.surface === "settings";
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

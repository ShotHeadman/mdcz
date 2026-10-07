import type {
  CrawlerData,
  FieldDiff,
  FieldDiffImageCollectionPreview,
  FieldDiffImagePreview,
  LocalScanEntry,
  MaintenanceDiffField,
  MaintenanceImageAlternatives,
} from "@mdcz/shared/types";

interface DiffCrawlerDataOptions {
  entry?: LocalScanEntry;
  imageAlternatives?: MaintenanceImageAlternatives;
  /** Keys whose old values someone edited after MDCz published them. */
  userEdited?: ReadonlySet<keyof CrawlerData>;
}

export interface PartitionedCrawlerDataDiffs {
  fieldDiffs: FieldDiff[];
  unchangedFieldDiffs: FieldDiff[];
}

const VALUE_FIELDS: MaintenanceDiffField[] = [
  "title",
  "title_zh",
  "plot",
  "plot_zh",
  "studio",
  "director",
  "publisher",
  "series",
  "release_date",
  "rating",
  "durationSeconds",
  "content_type",
];

const TRAILER_FIELDS = ["trailer_url"] as const;

const VALUE_SOURCE_FIELD_MAP = {
  trailer_url: "trailer_source_url",
} as const satisfies Partial<Record<keyof CrawlerData, keyof CrawlerData>>;

// In maintenance mode, fanart is treated as a derived local asset from thumb,
// so only independently switchable primary images are diffed here.
const IMAGE_FIELDS = ["thumb_url", "poster_url"] as const;

const ARRAY_VALUE_FIELDS: MaintenanceDiffField[] = ["actors", "genres"];

const IMAGE_COLLECTION_FIELDS = ["scene_images"] as const;

const IMAGE_ASSET_FIELD_MAP = {
  thumb_url: "thumb",
  poster_url: "poster",
} as const satisfies Partial<Record<keyof CrawlerData, keyof LocalScanEntry["assets"]>>;

const IMAGE_SOURCE_FIELD_MAP = {
  thumb_url: "thumb_source_url",
  poster_url: "poster_source_url",
} as const satisfies Record<"thumb_url" | "poster_url", keyof CrawlerData>;

const isEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => isEqual(val, b[i]));
  }
  return false;
};

const hasValue = (value: unknown): boolean => {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

const toNonEmptyString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const toRemoteHttpSource = (value: unknown): string => {
  const normalized = toNonEmptyString(value);
  return /^https?:\/\//iu.test(normalized) ? normalized : "";
};

const isUrlLike = (value: string): boolean => /^(?:https?:\/\/|data:|blob:|local-file:\/\/|file:\/\/)/iu.test(value);

const isAbsolutePath = (value: string): boolean => {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("\\\\");
};

const getParentDir = (value: string | undefined): string => {
  if (!value) {
    return "";
  }

  const lastSlash = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  return lastSlash >= 0 ? value.slice(0, lastSlash) : "";
};

const joinPath = (dir: string, child: string): string => {
  const base = dir.trim();
  const leaf = child.trim();
  if (!base) {
    return leaf;
  }
  if (!leaf) {
    return base;
  }

  const useBackslash = base.lastIndexOf("\\") > base.lastIndexOf("/");
  const separator = useBackslash ? "\\" : "/";
  const normalizedBase = base.endsWith("/") || base.endsWith("\\") ? base.slice(0, -1) : base;
  const normalizedLeaf = leaf.replace(/^[/\\]+/u, "");

  return `${normalizedBase}${separator}${normalizedLeaf}`;
};

const getAssetPath = (entry: LocalScanEntry | undefined, field: keyof typeof IMAGE_ASSET_FIELD_MAP): string => {
  const assetKey = IMAGE_ASSET_FIELD_MAP[field];
  const assetValue = assetKey ? entry?.assets[assetKey] : undefined;
  return typeof assetValue === "string" ? assetValue : "";
};

const resolveImageValue = (value: unknown, entry: LocalScanEntry | undefined): string => {
  const rawValue = toNonEmptyString(value);
  if (!rawValue) {
    return "";
  }

  if (isUrlLike(rawValue) || isAbsolutePath(rawValue)) {
    return rawValue;
  }

  const baseDir = getParentDir(entry?.nfoPath) || entry?.currentDir;
  if (baseDir) {
    return joinPath(baseDir, rawValue);
  }

  return rawValue;
};

const dedupeCandidates = (values: Array<string | undefined>): string[] => {
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const value of values) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    candidates.push(trimmed);
  }

  return candidates;
};

const buildImagePreview = (
  field: "thumb_url" | "poster_url",
  value: unknown,
  entry: LocalScanEntry | undefined,
  side: "old" | "new",
  imageAlternatives: MaintenanceImageAlternatives | undefined,
): FieldDiffImagePreview => {
  const src =
    side === "old" ? getAssetPath(entry, field) || resolveImageValue(value, entry) : resolveImageValue(value, entry);
  const fallbackSrcs =
    side === "new" ? dedupeCandidates(imageAlternatives?.[field] ?? []).filter((candidate) => candidate !== src) : [];

  return { src, fallbackSrcs };
};

const buildSceneImagePreview = (items: unknown, entry?: LocalScanEntry): FieldDiffImageCollectionPreview => {
  return {
    items: Array.isArray(items)
      ? items
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .map((item) => resolveImageValue(item, entry))
      : [],
  };
};

const normalizeImageCollectionValue = (value: unknown): string[] => {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
};

const hasPreviewContent = (diff: FieldDiff, side: "old" | "new"): boolean => {
  if (diff.kind === "image") {
    const preview = side === "old" ? diff.oldPreview : diff.newPreview;
    return preview.src.length > 0 || preview.fallbackSrcs.length > 0;
  }

  if (diff.kind === "imageCollection") {
    const preview = side === "old" ? diff.oldPreview : diff.newPreview;
    return preview.items.length > 0;
  }

  return hasValue(side === "old" ? diff.oldValue : diff.newValue);
};

const buildValueDiff = (
  field: MaintenanceDiffField,
  oldValue: unknown,
  newValue: unknown,
  changed: boolean,
): FieldDiff => ({
  kind: "value",
  field,
  oldValue,
  newValue,
  changed,
});

const buildSourceAwareValueDiff = (
  field: keyof typeof VALUE_SOURCE_FIELD_MAP,
  oldData: CrawlerData,
  newData: CrawlerData,
): FieldDiff => {
  const oldValue = oldData[field];
  const newValue = newData[field];
  const rawChanged = !isEqual(oldValue, newValue);
  const sourceField = VALUE_SOURCE_FIELD_MAP[field];
  const oldSource = toRemoteHttpSource(oldData[sourceField]) || toRemoteHttpSource(oldValue);
  const newSource = toRemoteHttpSource(newData[sourceField]) || toRemoteHttpSource(newValue);
  const changed = oldSource || newSource ? oldSource !== newSource : rawChanged;

  return buildValueDiff(field, oldValue, newValue, changed);
};

const buildImageFieldDiff = (
  field: "thumb_url" | "poster_url",
  oldData: CrawlerData,
  newData: CrawlerData,
  entry: LocalScanEntry | undefined,
  imageAlternatives: MaintenanceImageAlternatives | undefined,
): FieldDiff => {
  const oldValue = oldData[field];
  const newValue = newData[field];
  const oldPreview = buildImagePreview(field, oldValue, entry, "old", imageAlternatives);
  const newPreview = buildImagePreview(field, newValue, undefined, "new", imageAlternatives);

  const rawChanged = !isEqual(oldValue, newValue);
  const sourceField = IMAGE_SOURCE_FIELD_MAP[field];
  const oldSource =
    toRemoteHttpSource(oldData[sourceField]) || toRemoteHttpSource(oldValue) || toRemoteHttpSource(oldPreview.src);
  const newSource =
    toRemoteHttpSource(newData[sourceField]) || toRemoteHttpSource(newValue) || toRemoteHttpSource(newPreview.src);
  const changed = oldSource || newSource ? oldSource !== newSource : rawChanged;

  return {
    kind: "image",
    field,
    oldValue,
    newValue,
    changed,
    oldPreview,
    newPreview,
  };
};

const buildImageCollectionFieldDiff = (
  field: "scene_images",
  oldData: CrawlerData,
  newData: CrawlerData,
  entry: LocalScanEntry | undefined,
): FieldDiff => {
  const oldValue = normalizeImageCollectionValue(oldData[field]);
  const newValue = normalizeImageCollectionValue(newData[field]);
  const hasLocalSceneImages = (entry?.assets.sceneImages.length ?? 0) > 0;
  const oldPreview = buildSceneImagePreview(hasLocalSceneImages ? entry?.assets.sceneImages : oldValue, entry);
  const newPreview = buildSceneImagePreview(newValue, entry);

  return {
    kind: "imageCollection",
    field,
    oldValue,
    newValue,
    changed: !isEqual(oldValue, newValue),
    oldPreview,
    newPreview,
  };
};

/**
 * Compute field-level diffs between old (local NFO) and new (network) CrawlerData.
 * Only includes fields whose values actually changed.
 */
export function diffCrawlerData(oldData: CrawlerData, newData: CrawlerData): FieldDiff[] {
  return partitionCrawlerDataWithOptions(oldData, newData, {}).fieldDiffs;
}

export function partitionCrawlerDataWithOptions(
  oldData: CrawlerData,
  newData: CrawlerData,
  options: DiffCrawlerDataOptions,
): PartitionedCrawlerDataDiffs {
  const fieldDiffs: FieldDiff[] = [];
  const unchangedFieldDiffs: FieldDiff[] = [];
  const entry = options.entry;
  const imageAlternatives = options.imageAlternatives;

  for (const key of VALUE_FIELDS) {
    const diff =
      key in VALUE_SOURCE_FIELD_MAP
        ? buildSourceAwareValueDiff(key as keyof typeof VALUE_SOURCE_FIELD_MAP, oldData, newData)
        : buildValueDiff(key, oldData[key], newData[key], !isEqual(oldData[key], newData[key]));

    if (!diff.changed && !hasPreviewContent(diff, "old")) {
      continue;
    }

    (diff.changed ? fieldDiffs : unchangedFieldDiffs).push(diff);
  }

  for (const key of IMAGE_FIELDS) {
    const diff = buildImageFieldDiff(key, oldData, newData, entry, imageAlternatives);
    if (!diff.changed && !hasPreviewContent(diff, "old")) {
      continue;
    }

    (diff.changed ? fieldDiffs : unchangedFieldDiffs).push(diff);
  }

  for (const key of ARRAY_VALUE_FIELDS) {
    const oldValue = oldData[key];
    const newValue = newData[key];
    const changed = !isEqual(oldValue, newValue);
    const diff = buildValueDiff(key, oldValue, newValue, changed);

    if (!changed && !hasPreviewContent(diff, "old")) {
      continue;
    }

    (changed ? fieldDiffs : unchangedFieldDiffs).push(diff);
  }

  for (const key of IMAGE_COLLECTION_FIELDS) {
    const diff = buildImageCollectionFieldDiff(key, oldData, newData, entry);
    if (!diff.changed && !hasPreviewContent(diff, "old")) {
      continue;
    }

    (diff.changed ? fieldDiffs : unchangedFieldDiffs).push(diff);
  }

  for (const key of TRAILER_FIELDS) {
    const diff = buildSourceAwareValueDiff(key, oldData, newData);
    if (!diff.changed && !hasPreviewContent(diff, "old")) {
      continue;
    }

    (diff.changed ? fieldDiffs : unchangedFieldDiffs).push(diff);
  }

  for (const diff of fieldDiffs) if (options.userEdited?.has(diff.field)) diff.userEdited = true;

  return {
    fieldDiffs,
    unchangedFieldDiffs,
  };
}

import type {
  CrawlerData,
  FieldDiff,
  LocalScanEntry,
  MaintenanceCommitItem,
  MaintenanceImageAlternatives,
  MaintenancePreviewItem,
} from "@shared/types";

export type MaintenanceFieldSelectionSide = "old" | "new";

const IMAGE_ASSET_FIELD_MAP = {
  thumb_url: "thumb",
  poster_url: "poster",
  fanart_url: "fanart",
} as const satisfies Partial<Record<FieldDiff["field"], keyof LocalScanEntry["assets"]>>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const cloneValue = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as T;
  }

  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)])) as T;
  }

  return value;
};

export const hasMaintenanceFieldValue = (value: unknown): boolean => {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

const toNonEmptyString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

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

const getMaintenanceImageAssetPath = (entry: LocalScanEntry | undefined, field: FieldDiff["field"]): string => {
  const assetKey = IMAGE_ASSET_FIELD_MAP[field as keyof typeof IMAGE_ASSET_FIELD_MAP];
  const assetValue = assetKey ? entry?.assets[assetKey] : undefined;
  return typeof assetValue === "string" ? assetValue : "";
};

export const resolveMaintenanceDiffImageSrc = (
  entry: LocalScanEntry | undefined,
  diff: FieldDiff,
  side: MaintenanceFieldSelectionSide,
): string => {
  if (!(diff.field in IMAGE_ASSET_FIELD_MAP)) {
    return "";
  }

  if (side === "old") {
    const assetPath = getMaintenanceImageAssetPath(entry, diff.field);
    if (assetPath) {
      return assetPath;
    }
  }

  const rawValue = toNonEmptyString(side === "old" ? diff.oldValue : diff.newValue);
  if (!rawValue) {
    return "";
  }

  if (isUrlLike(rawValue) || isAbsolutePath(rawValue)) {
    return rawValue;
  }

  if (side === "old") {
    const baseDir = getParentDir(entry?.nfoPath) || entry?.currentDir || getParentDir(entry?.videoPath);
    if (baseDir) {
      return joinPath(baseDir, rawValue);
    }
  }

  return rawValue;
};

export const getDefaultMaintenanceFieldSelection = (diff: FieldDiff): MaintenanceFieldSelectionSide => {
  const hasOldValue = hasMaintenanceFieldValue(diff.oldValue);
  const hasNewValue = hasMaintenanceFieldValue(diff.newValue);

  if (!hasOldValue && hasNewValue) return "new";
  if (hasOldValue && !hasNewValue) return "old";
  return "new";
};

export const buildCommittedCrawlerData = (
  entry: LocalScanEntry,
  preview: MaintenancePreviewItem | undefined,
  fieldSelections: Record<string, MaintenanceFieldSelectionSide> | undefined,
): CrawlerData | undefined => {
  const proposedCrawlerData = preview?.proposedCrawlerData;

  if (!entry.crawlerData && !proposedCrawlerData) {
    return undefined;
  }

  const resolved = cloneValue(proposedCrawlerData ?? entry.crawlerData);
  if (!resolved) {
    return undefined;
  }

  if (!entry.crawlerData || !preview?.fieldDiffs?.length) {
    return resolved;
  }

  const baseData = cloneValue(entry.crawlerData);
  const mutableBaseData = baseData as unknown as Record<string, unknown>;

  for (const diff of preview.fieldDiffs) {
    const selection = fieldSelections?.[diff.field] ?? getDefaultMaintenanceFieldSelection(diff);
    const selectedValue = selection === "old" ? diff.oldValue : diff.newValue;
    mutableBaseData[diff.field] = cloneValue(selectedValue);
  }

  return baseData;
};

export const buildMaintenanceCommitItem = (
  entry: LocalScanEntry,
  preview: MaintenancePreviewItem | undefined,
  fieldSelections: Record<string, MaintenanceFieldSelectionSide> | undefined,
): MaintenanceCommitItem => {
  const crawlerData = buildCommittedCrawlerData(entry, preview, fieldSelections);
  const proposedCrawlerData = preview?.proposedCrawlerData;
  const imageAlternatives = preview?.imageAlternatives;
  const filteredAlternatives: MaintenanceImageAlternatives = {};

  if (crawlerData && proposedCrawlerData && imageAlternatives) {
    for (const field of ["thumb_url", "poster_url", "fanart_url"] as const) {
      if (crawlerData[field] === proposedCrawlerData[field] && imageAlternatives[field]?.length) {
        filteredAlternatives[field] = imageAlternatives[field];
      }
    }
  }

  return {
    entry,
    crawlerData,
    imageAlternatives: Object.keys(filteredAlternatives).length > 0 ? filteredAlternatives : undefined,
  };
};

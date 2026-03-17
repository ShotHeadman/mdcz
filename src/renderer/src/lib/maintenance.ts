import type {
  CrawlerData,
  FieldDiff,
  LocalScanEntry,
  MaintenanceAssetDecisions,
  MaintenanceCommitItem,
  MaintenanceImageAlternatives,
  MaintenancePreviewItem,
} from "@shared/types";

export type MaintenanceFieldSelectionSide = "old" | "new";

const IMAGE_SOURCE_FIELD_MAP = {
  thumb_url: "thumb_source_url",
  poster_url: "poster_source_url",
} as const;
const VALUE_SOURCE_FIELD_MAP = {
  trailer_url: "trailer_source_url",
} as const;

const getImageSourceField = (
  field: FieldDiff["field"],
): (typeof IMAGE_SOURCE_FIELD_MAP)[keyof typeof IMAGE_SOURCE_FIELD_MAP] | undefined => {
  switch (field) {
    case "thumb_url":
    case "poster_url":
      return IMAGE_SOURCE_FIELD_MAP[field];
    default:
      return undefined;
  }
};

const getValueSourceField = (
  field: FieldDiff["field"],
): (typeof VALUE_SOURCE_FIELD_MAP)[keyof typeof VALUE_SOURCE_FIELD_MAP] | undefined => {
  switch (field) {
    case "trailer_url":
      return VALUE_SOURCE_FIELD_MAP[field];
    default:
      return undefined;
  }
};

const cloneValue = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, cloneValue(item)]),
    ) as T;
  }

  return value;
};

const toRemoteSourceValue = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return /^https?:\/\//iu.test(normalized) ? normalized : undefined;
};

const getPathLeafName = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }

  const lastSlash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
};

const toLocalImageFieldValue = (value: string): string | undefined => {
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  if (/^(?:https?:|data:|blob:)/iu.test(normalized)) {
    return undefined;
  }

  if (/^(?:local-file|file):\/\//iu.test(normalized)) {
    try {
      const parsed = new URL(normalized);
      const pathname = decodeURIComponent(parsed.pathname);
      const localPath = /^\/[A-Za-z]:\//u.test(pathname) ? pathname.slice(1) : pathname;
      const leafName = getPathLeafName(localPath);
      return leafName || undefined;
    } catch {
      return undefined;
    }
  }

  const leafName = getPathLeafName(normalized);
  return leafName || undefined;
};

export const hasMaintenanceFieldValue = (value: unknown): boolean => {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

export const hasMaintenanceDiffSideValue = (diff: FieldDiff, side: MaintenanceFieldSelectionSide): boolean => {
  if (diff.kind === "image") {
    const preview = side === "old" ? diff.oldPreview : diff.newPreview;
    return preview.src.length > 0 || preview.fallbackSrcs.length > 0;
  }

  if (diff.kind === "imageCollection") {
    const preview = side === "old" ? diff.oldPreview : diff.newPreview;
    return preview.items.length > 0;
  }

  return hasMaintenanceFieldValue(side === "old" ? diff.oldValue : diff.newValue);
};

export const resolveMaintenanceDiffImageSrc = (diff: FieldDiff, side: MaintenanceFieldSelectionSide): string => {
  if (diff.kind !== "image") {
    return "";
  }

  return side === "old" ? diff.oldPreview.src : diff.newPreview.src;
};

export const resolveMaintenanceDiffImageOption = (
  diff: FieldDiff,
  side: MaintenanceFieldSelectionSide,
): { src: string; fallbackSrcs: string[] } => {
  if (diff.kind !== "image") {
    return { src: "", fallbackSrcs: [] };
  }

  return side === "old" ? diff.oldPreview : diff.newPreview;
};

export const resolveMaintenanceDiffImageCollection = (
  diff: FieldDiff,
  side: MaintenanceFieldSelectionSide,
): string[] => {
  if (diff.kind !== "imageCollection") {
    return [];
  }

  return side === "old" ? diff.oldPreview.items : diff.newPreview.items;
};

export const getDefaultMaintenanceFieldSelection = (diff: FieldDiff): MaintenanceFieldSelectionSide => {
  const hasOldValue = hasMaintenanceDiffSideValue(diff, "old");
  const hasNewValue = hasMaintenanceDiffSideValue(diff, "new");

  if (!hasOldValue && hasNewValue) return "new";
  if (hasOldValue && !hasNewValue) return "old";
  return "new";
};

const buildSelectedImageSourceValue = (diff: FieldDiff): string | undefined => {
  if (diff.kind !== "image") {
    return undefined;
  }

  return toRemoteSourceValue(diff.newValue) ?? toRemoteSourceValue(diff.newPreview.src);
};

const buildSelectedValueSourceValue = (diff: FieldDiff): string | undefined => {
  if (diff.kind !== "value") {
    return undefined;
  }

  return toRemoteSourceValue(diff.newValue);
};

const syncSharedFanartWithThumbSelection = (
  mutableBaseData: Record<string, unknown>,
  diff: FieldDiff,
  selection: MaintenanceFieldSelectionSide,
  options?: {
    clearDerivedFanartWhenPreservingLocal?: boolean;
  },
): void => {
  if (diff.kind !== "image" || diff.field !== "thumb_url") {
    return;
  }

  if (selection === "old") {
    if (options?.clearDerivedFanartWhenPreservingLocal) {
      mutableBaseData.fanart_url = undefined;
      mutableBaseData.fanart_source_url = undefined;
    }
    return;
  }

  mutableBaseData.fanart_url = undefined;
  mutableBaseData.fanart_source_url = cloneValue(buildSelectedImageSourceValue(diff));
};

const applyOldImageSelection = (
  mutableBaseData: Record<string, unknown>,
  diff: Extract<FieldDiff, { kind: "image" }>,
  hasExistingCrawlerData: boolean,
): void => {
  if (hasExistingCrawlerData) {
    mutableBaseData[diff.field] = cloneValue(diff.oldValue);
    return;
  }

  mutableBaseData[diff.field] = cloneValue(toLocalImageFieldValue(diff.oldPreview.src) ?? diff.oldValue);

  const sourceField = getImageSourceField(diff.field);
  if (sourceField) {
    mutableBaseData[sourceField] = undefined;
  }

  syncSharedFanartWithThumbSelection(mutableBaseData, diff, "old", {
    clearDerivedFanartWhenPreservingLocal: true,
  });
};

export const buildCommittedCrawlerData = (
  entry: LocalScanEntry,
  preview: MaintenancePreviewItem | undefined,
  fieldSelections: Record<string, MaintenanceFieldSelectionSide> | undefined,
): CrawlerData | undefined => {
  const proposedCrawlerData = preview?.proposedCrawlerData;
  const hasExistingCrawlerData = Boolean(entry.crawlerData);

  if (!hasExistingCrawlerData && !proposedCrawlerData) {
    return undefined;
  }

  const baseData = cloneValue(entry.crawlerData ?? proposedCrawlerData);
  if (!baseData) {
    return undefined;
  }

  if (!preview?.fieldDiffs?.length) {
    return baseData;
  }

  const mutableBaseData = baseData as unknown as Record<string, unknown>;

  for (const diff of preview.fieldDiffs) {
    const selection = fieldSelections?.[diff.field] ?? getDefaultMaintenanceFieldSelection(diff);
    if (selection === "old") {
      if (diff.kind === "image") {
        applyOldImageSelection(mutableBaseData, diff, hasExistingCrawlerData);
      } else {
        mutableBaseData[diff.field] = cloneValue(diff.oldValue);

        if (!hasExistingCrawlerData) {
          const sourceField = getValueSourceField(diff.field);
          if (sourceField) {
            mutableBaseData[sourceField] = undefined;
          }
        }
      }
      continue;
    }

    mutableBaseData[diff.field] = cloneValue(diff.newValue);

    if (diff.kind === "image") {
      const sourceField = getImageSourceField(diff.field);
      if (!sourceField) {
        continue;
      }

      mutableBaseData[sourceField] = cloneValue(buildSelectedImageSourceValue(diff));
    }

    if (diff.kind === "value") {
      const sourceField = getValueSourceField(diff.field);
      if (sourceField) {
        mutableBaseData[sourceField] = cloneValue(buildSelectedValueSourceValue(diff));
      }
    }

    syncSharedFanartWithThumbSelection(mutableBaseData, diff, selection);
  }

  return baseData;
};

const buildAssetDecisions = (
  fieldDiffs: FieldDiff[] | undefined,
  fieldSelections: Record<string, MaintenanceFieldSelectionSide> | undefined,
): MaintenanceAssetDecisions | undefined => {
  const assetDecisions: MaintenanceAssetDecisions = {};

  for (const diff of fieldDiffs ?? []) {
    const selection = fieldSelections?.[diff.field] ?? getDefaultMaintenanceFieldSelection(diff);

    if (diff.field === "thumb_url" && diff.kind === "image") {
      assetDecisions.fanart = selection === "old" ? "preserve" : "replace";
    }

    if (diff.field === "sample_images" && diff.kind === "imageCollection") {
      assetDecisions.sceneImages = selection === "old" ? "preserve" : "replace";
    }

    if (diff.field === "trailer_url" && diff.kind === "value") {
      assetDecisions.trailer = selection === "old" ? "preserve" : "replace";
    }
  }

  return Object.keys(assetDecisions).length > 0 ? assetDecisions : undefined;
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
    for (const field of ["thumb_url", "poster_url"] as const) {
      if (crawlerData[field] === proposedCrawlerData[field] && imageAlternatives[field]?.length) {
        filteredAlternatives[field] = imageAlternatives[field];
      }
    }
  }

  for (const diff of preview?.fieldDiffs ?? []) {
    const selectedSide = fieldSelections?.[diff.field] ?? getDefaultMaintenanceFieldSelection(diff);
    if (diff.field === "sample_images" && diff.kind === "imageCollection" && selectedSide === "new") {
      if (imageAlternatives?.sample_images?.length) {
        filteredAlternatives.sample_images = imageAlternatives.sample_images;
      }
    }
  }

  return {
    entry,
    crawlerData,
    imageAlternatives: Object.keys(filteredAlternatives).length > 0 ? filteredAlternatives : undefined,
    assetDecisions: buildAssetDecisions(preview?.fieldDiffs, fieldSelections),
  };
};

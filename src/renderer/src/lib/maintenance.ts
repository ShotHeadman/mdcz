import type {
  CrawlerData,
  FieldDiff,
  LocalScanEntry,
  MaintenanceCommitItem,
  MaintenanceImageAlternatives,
  MaintenancePreviewItem,
} from "@shared/types";

export type MaintenanceFieldSelectionSide = "old" | "new";

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

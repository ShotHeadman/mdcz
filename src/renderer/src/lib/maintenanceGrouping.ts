import type { LocalScanEntry, MaintenanceItemResult, MaintenancePreviewItem } from "@shared/types";
import { countMultipartDisplayGroups, type MultipartDisplayGroup } from "@/lib/multipartDisplay";
import { buildRendererGroups, findRendererGroup, type RendererGroup } from "@/lib/rendererGroupModel";

export interface MaintenanceEntryGroup extends RendererGroup<LocalScanEntry> {
  previewItems: MaintenancePreviewItem[];
  resultItems: MaintenanceItemResult[];
  compareResult?: MaintenanceItemResult | MaintenancePreviewItem;
}

interface BuildMaintenanceEntryGroupsOptions {
  itemResults?: Record<string, MaintenanceItemResult>;
  previewResults?: Record<string, MaintenancePreviewItem>;
}

interface MaintenanceExecutionGroupSummary {
  totalCount: number;
  completedCount: number;
  successCount: number;
  failedCount: number;
  activeCount: number;
}

interface MaintenancePreviewGroupSummary {
  totalCount: number;
  readyCount: number;
  blockedCount: number;
}

const resolveMaintenanceGroupingDirectory = (
  entry: LocalScanEntry,
  options: BuildMaintenanceEntryGroupsOptions,
): string | undefined => {
  return (
    options.itemResults?.[entry.id]?.pathDiff?.currentDir ??
    options.previewResults?.[entry.id]?.pathDiff?.currentDir ??
    entry.currentDir
  );
};

const createMaintenanceMultipartSelectors = (options: BuildMaintenanceEntryGroupsOptions) => ({
  getDirectory: (entry: LocalScanEntry) => resolveMaintenanceGroupingDirectory(entry, options),
  getFileName: (entry: LocalScanEntry) => entry.fileInfo.fileName,
  getItemKey: (entry: LocalScanEntry) => entry.id,
  getNumber: (entry: LocalScanEntry) => entry.fileInfo.number,
  getPart: (entry: LocalScanEntry) => entry.fileInfo.part,
});

const getMaintenanceGroupStatus = (
  group: MultipartDisplayGroup<LocalScanEntry>,
  itemResults: Record<string, MaintenanceItemResult>,
): MaintenanceEntryGroup["status"] => {
  const statuses = group.items.map((entry) => getMaintenanceEntryStatus(entry, itemResults[entry.id]));
  if (statuses.some((value) => value === "failed")) {
    return "failed";
  }

  if (statuses.some((value) => value === "processing" || value === "pending")) {
    return "processing";
  }

  if (statuses.length > 0 && statuses.every((value) => value === "success")) {
    return "success";
  }

  return "idle";
};

const pickMaintenanceCompareResult = (
  group: RendererGroup<LocalScanEntry>,
  resultItems: MaintenanceItemResult[],
  previewItems: MaintenancePreviewItem[],
): MaintenanceItemResult | MaintenancePreviewItem | undefined => {
  const failedResult = resultItems.find((item) => item.status === "failed");
  if (failedResult) {
    return failedResult;
  }

  const representativeResult = resultItems.find((item) => item.entryId === group.representative.id);
  if (representativeResult) {
    return representativeResult;
  }

  const blockedPreview = previewItems.find((item) => item.status === "blocked");
  if (blockedPreview) {
    return blockedPreview;
  }

  const representativePreview = previewItems.find((item) => item.entryId === group.representative.id);
  if (representativePreview) {
    return representativePreview;
  }

  return resultItems[0] ?? previewItems[0];
};

export const buildMaintenanceEntryGroups = (
  entries: LocalScanEntry[],
  options: BuildMaintenanceEntryGroupsOptions = {},
): MaintenanceEntryGroup[] => {
  const itemResults = options.itemResults ?? {};
  const previewResults = options.previewResults ?? {};

  return buildRendererGroups(entries, {
    selectors: createMaintenanceMultipartSelectors(options),
    buildStatus: (group) => getMaintenanceGroupStatus(group, itemResults),
    buildErrorText: (group) =>
      group.items
        .map((entry) => itemResults[entry.id]?.error ?? entry.scanError ?? previewResults[entry.id]?.error)
        .find((value): value is string => Boolean(value)),
  }).map((group) => {
    const resultItems = group.items.flatMap((entry) => {
      const result = itemResults[entry.id];
      return result ? [result] : [];
    });
    const previewItems = group.items.flatMap((entry) => {
      const preview = previewResults[entry.id];
      return preview ? [preview] : [];
    });

    return {
      ...group,
      resultItems,
      previewItems,
      compareResult: pickMaintenanceCompareResult(group, resultItems, previewItems),
    };
  });
};

export const countMaintenanceDisplayItems = (
  entries: LocalScanEntry[],
  options: BuildMaintenanceEntryGroupsOptions = {},
): number => countMultipartDisplayGroups(entries, createMaintenanceMultipartSelectors(options));

export const formatMaintenanceIdleStatusText = (entries: LocalScanEntry[], emptyText = "就绪"): string => {
  if (entries.length === 0) {
    return emptyText;
  }

  return `已扫描 ${countMaintenanceDisplayItems(entries)} 项`;
};

export const summarizeMaintenancePreviewGroups = (
  entries: LocalScanEntry[],
  previewResults: Record<string, MaintenancePreviewItem>,
): MaintenancePreviewGroupSummary => {
  let totalCount = 0;
  let readyCount = 0;
  let blockedCount = 0;

  for (const group of buildMaintenanceEntryGroups(entries, { previewResults })) {
    const groupPreviewItems = group.items.flatMap((entry) => {
      const preview = previewResults[entry.id];
      return preview ? [preview] : [];
    });

    if (groupPreviewItems.length === 0) {
      continue;
    }

    totalCount += 1;
    const ready =
      groupPreviewItems.length === group.items.length && groupPreviewItems.every((item) => item.status === "ready");
    if (ready) {
      readyCount += 1;
      continue;
    }

    blockedCount += 1;
  }

  return {
    totalCount,
    readyCount,
    blockedCount,
  };
};

export const summarizeMaintenanceExecutionGroups = (
  entries: LocalScanEntry[],
  itemResults: Record<string, MaintenanceItemResult>,
): MaintenanceExecutionGroupSummary => {
  let totalCount = 0;
  let completedCount = 0;
  let successCount = 0;
  let failedCount = 0;
  let activeCount = 0;

  for (const group of buildMaintenanceEntryGroups(entries, { itemResults })) {
    const groupResultItems = group.items.flatMap((entry) => {
      const result = itemResults[entry.id];
      return result ? [result] : [];
    });

    if (groupResultItems.length === 0) {
      continue;
    }

    totalCount += 1;

    const statuses = groupResultItems.map((item) => item.status);
    const allChildrenReported = groupResultItems.length === group.items.length;
    const hasActiveChild = statuses.some((status) => status === "pending" || status === "processing");
    const allSuccess = allChildrenReported && statuses.every((status) => status === "success");
    const allTerminalWithFailure =
      allChildrenReported && !hasActiveChild && statuses.some((status) => status === "failed");

    if (allSuccess) {
      completedCount += 1;
      successCount += 1;
      continue;
    }

    if (allTerminalWithFailure) {
      completedCount += 1;
      failedCount += 1;
      continue;
    }

    activeCount += 1;
  }

  return {
    totalCount,
    completedCount,
    successCount,
    failedCount,
    activeCount,
  };
};

const getMaintenanceEntryStatus = (
  entry: LocalScanEntry,
  result?: MaintenanceItemResult,
): MaintenanceItemResult["status"] | "idle" => {
  if (result?.status === "processing") {
    return "processing";
  }

  if (result?.status === "pending") {
    return "pending";
  }

  if (result?.status === "failed" || entry.scanError) {
    return "failed";
  }

  if (result?.status === "success") {
    return "success";
  }

  return "idle";
};

export const findMaintenanceEntryGroup = (
  entries: LocalScanEntry[],
  id: string | null | undefined,
  options: BuildMaintenanceEntryGroupsOptions = {},
): MaintenanceEntryGroup | undefined => {
  return findRendererGroup(buildMaintenanceEntryGroups(entries, options), id, (entry) => entry.id);
};

import type { LocalScanEntry, MaintenanceItemResult, MaintenancePreviewItem, PathDiff } from "@shared/types";
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

interface MaintenanceGroupExecutionState {
  active: boolean;
  completed: boolean;
  failed: boolean;
  hasResults: boolean;
  success: boolean;
}

interface MaintenanceGroupPreviewState {
  blockedPreview?: MaintenancePreviewItem;
  changedPathItems: Array<{ entry: LocalScanEntry; pathDiff: PathDiff }>;
  diffCount: number;
  hasPathChange: boolean;
  hasPreview: boolean;
  ready: boolean;
}

export interface MaintenanceEntryGroupViewModel extends MaintenanceEntryGroup {
  executableItems: LocalScanEntry[];
  executionState: MaintenanceGroupExecutionState;
  previewState: MaintenanceGroupPreviewState;
}

export interface MaintenanceEntryCollectionViewModel {
  displayCount: number;
  executableEntries: LocalScanEntry[];
  executionSummary: MaintenanceExecutionGroupSummary;
  groups: MaintenanceEntryGroupViewModel[];
  previewSummary: MaintenancePreviewGroupSummary;
}

const maintenanceMultipartSelectors = {
  getDirectory: (entry: LocalScanEntry) => entry.groupingDirectory ?? entry.currentDir,
  getFileName: (entry: LocalScanEntry) => entry.fileInfo.fileName,
  getItemKey: (entry: LocalScanEntry) => entry.fileId,
  getNumber: (entry: LocalScanEntry) => entry.fileInfo.number,
  getPart: (entry: LocalScanEntry) => entry.fileInfo.part,
};

const getMaintenanceEntryStatus = (
  entry: LocalScanEntry,
  result?: MaintenanceItemResult,
  preview?: MaintenancePreviewItem,
): MaintenanceItemResult["status"] | "idle" => {
  if (result?.status === "processing") {
    return "processing";
  }

  if (result?.status === "pending") {
    return "pending";
  }

  if (result?.status === "failed") {
    return "failed";
  }

  if (result?.status === "success") {
    return "success";
  }

  if (preview?.status === "blocked") {
    return "failed";
  }

  if (preview?.status === "ready") {
    return "success";
  }

  if (entry.scanError) {
    return "failed";
  }

  return "idle";
};

const getMaintenanceGroupStatus = (
  group: RendererGroup<LocalScanEntry>["items"],
  itemResults: Record<string, MaintenanceItemResult>,
  previewResults: Record<string, MaintenancePreviewItem>,
): MaintenanceEntryGroup["status"] => {
  const statuses = group.map((entry) =>
    getMaintenanceEntryStatus(entry, itemResults[entry.fileId], previewResults[entry.fileId]),
  );
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

const getMaintenanceEntryErrorText = (
  entry: LocalScanEntry,
  result?: MaintenanceItemResult,
  preview?: MaintenancePreviewItem,
): string | undefined => {
  if (result?.status === "failed") {
    return result.error ?? preview?.error ?? entry.scanError;
  }

  if (result?.status === "success" || result?.status === "processing" || result?.status === "pending") {
    return undefined;
  }

  if (preview?.status === "blocked") {
    return preview.error ?? entry.scanError;
  }

  if (preview?.status === "ready") {
    return undefined;
  }

  return entry.scanError;
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

  const blockedPreview = previewItems.find((item) => item.status === "blocked");
  if (blockedPreview) {
    return blockedPreview;
  }

  const representativePreview = previewItems.find((item) => item.fileId === group.representative.fileId);
  if (representativePreview) {
    return representativePreview;
  }

  const representativeResult = resultItems.find((item) => item.fileId === group.representative.fileId);
  if (representativeResult) {
    return representativeResult;
  }

  return previewItems[0] ?? resultItems[0];
};

export const buildMaintenanceEntryGroups = (
  entries: LocalScanEntry[],
  options: BuildMaintenanceEntryGroupsOptions = {},
): MaintenanceEntryGroup[] => {
  const itemResults = options.itemResults ?? {};
  const previewResults = options.previewResults ?? {};

  return buildRendererGroups(entries, {
    selectors: maintenanceMultipartSelectors,
    buildStatus: (group) => getMaintenanceGroupStatus(group.items, itemResults, previewResults),
    buildErrorText: (group) =>
      group.items
        .map((entry) => getMaintenanceEntryErrorText(entry, itemResults[entry.fileId], previewResults[entry.fileId]))
        .find((value): value is string => Boolean(value)),
  }).map((group) => {
    const resultItems = group.items.flatMap((entry) => {
      const result = itemResults[entry.fileId];
      return result ? [result] : [];
    });
    const previewItems = group.items.flatMap((entry) => {
      const preview = previewResults[entry.fileId];
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

const buildPreviewState = (
  group: MaintenanceEntryGroup,
  previewResults: Record<string, MaintenancePreviewItem>,
): MaintenanceGroupPreviewState => {
  const changedPathItems = group.items.flatMap((entry) => {
    const pathDiff = previewResults[entry.fileId]?.pathDiff;
    return pathDiff?.changed ? [{ entry, pathDiff }] : [];
  });
  const ready =
    group.previewItems.length === group.items.length &&
    group.previewItems.every((preview) => preview.status === "ready");

  return {
    hasPreview: group.previewItems.length > 0,
    ready,
    blockedPreview: group.previewItems.find((preview) => preview.status === "blocked"),
    diffCount: Math.max(0, ...group.previewItems.map((preview) => preview.fieldDiffs?.length ?? 0)),
    changedPathItems,
    hasPathChange: changedPathItems.length > 0,
  };
};

const buildExecutionState = (group: MaintenanceEntryGroup): MaintenanceGroupExecutionState => {
  if (group.resultItems.length === 0) {
    return {
      active: false,
      completed: false,
      failed: false,
      hasResults: false,
      success: false,
    };
  }

  const statuses = group.resultItems.map((item) => item.status);
  const allChildrenReported = group.resultItems.length === group.items.length;
  const active = statuses.some((status) => status === "pending" || status === "processing");
  const success = allChildrenReported && statuses.every((status) => status === "success");
  const failed = allChildrenReported && !active && statuses.some((status) => status === "failed");

  return {
    active,
    completed: success || failed,
    failed,
    hasResults: true,
    success,
  };
};

export const buildMaintenanceEntryViewModel = (
  entries: LocalScanEntry[],
  options: BuildMaintenanceEntryGroupsOptions = {},
): MaintenanceEntryCollectionViewModel => {
  const previewResults = options.previewResults ?? {};
  let previewTotalCount = 0;
  let previewReadyCount = 0;
  let previewBlockedCount = 0;
  let executionTotalCount = 0;
  let executionCompletedCount = 0;
  let executionSuccessCount = 0;
  let executionFailedCount = 0;
  let executionActiveCount = 0;
  const executableEntries: LocalScanEntry[] = [];

  const groups = buildMaintenanceEntryGroups(entries, options).map((group) => {
    const previewState = buildPreviewState(group, previewResults);
    const executionState = buildExecutionState(group);
    const executableItems = previewState.ready ? group.items : [];

    if (previewState.hasPreview) {
      previewTotalCount += 1;
      if (previewState.ready) {
        previewReadyCount += 1;
      } else {
        previewBlockedCount += 1;
      }
    }

    if (executionState.hasResults) {
      executionTotalCount += 1;
      if (executionState.completed) {
        executionCompletedCount += 1;
      }
      if (executionState.success) {
        executionSuccessCount += 1;
      } else if (executionState.failed) {
        executionFailedCount += 1;
      } else {
        executionActiveCount += 1;
      }
    }

    executableEntries.push(...executableItems);

    return {
      ...group,
      previewState,
      executionState,
      executableItems,
    };
  });

  return {
    groups,
    displayCount: groups.length,
    executableEntries,
    previewSummary: {
      totalCount: previewTotalCount,
      readyCount: previewReadyCount,
      blockedCount: previewBlockedCount,
    },
    executionSummary: {
      totalCount: executionTotalCount,
      completedCount: executionCompletedCount,
      successCount: executionSuccessCount,
      failedCount: executionFailedCount,
      activeCount: executionActiveCount,
    },
  };
};

export const countMaintenanceDisplayItems = (
  entries: LocalScanEntry[],
  options: BuildMaintenanceEntryGroupsOptions = {},
): number => buildMaintenanceEntryViewModel(entries, options).displayCount;

export const formatMaintenanceIdleStatusText = (entries: LocalScanEntry[], emptyText = "就绪"): string => {
  if (entries.length === 0) {
    return emptyText;
  }

  return `已扫描 ${countMaintenanceDisplayItems(entries)} 项`;
};

export const summarizeMaintenancePreviewGroups = (
  entries: LocalScanEntry[],
  previewResults: Record<string, MaintenancePreviewItem>,
): MaintenancePreviewGroupSummary => buildMaintenanceEntryViewModel(entries, { previewResults }).previewSummary;

export const summarizeMaintenanceExecutionGroups = (
  entries: LocalScanEntry[],
  itemResults: Record<string, MaintenanceItemResult>,
): MaintenanceExecutionGroupSummary => buildMaintenanceEntryViewModel(entries, { itemResults }).executionSummary;

export const findMaintenanceEntryGroup = (
  entries: LocalScanEntry[],
  id: string | null | undefined,
  options: BuildMaintenanceEntryGroupsOptions = {},
): MaintenanceEntryGroup | undefined => {
  return findRendererGroup(buildMaintenanceEntryGroups(entries, options), id, (entry) => entry.fileId);
};

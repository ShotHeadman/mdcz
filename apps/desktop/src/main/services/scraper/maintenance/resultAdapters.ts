import type { MaintenanceRuntime, MaintenanceRuntimePreviewItem } from "@mdcz/runtime/maintenance";
import type { LocalScanEntry, MaintenanceItemResult, MaintenancePreviewItem } from "@mdcz/shared/types";

export const toMaintenancePreviewItem = (item: MaintenanceRuntimePreviewItem | undefined): MaintenancePreviewItem => {
  if (!item) {
    return {
      fileId: "",
      status: "blocked",
      error: "维护预览未返回结果",
    };
  }

  const output: MaintenancePreviewItem = {
    fileId: item.entry.fileId,
    status: item.status,
  };
  if (item.error) output.error = item.error;
  if (item.fieldDiffs.length > 0) output.fieldDiffs = item.fieldDiffs;
  if (item.unchangedFieldDiffs.length > 0) output.unchangedFieldDiffs = item.unchangedFieldDiffs;
  if (item.pathDiff) output.pathDiff = item.pathDiff;
  if (item.proposedCrawlerData) output.proposedCrawlerData = item.proposedCrawlerData;
  if (item.imageAlternatives) output.imageAlternatives = item.imageAlternatives;
  return output;
};

export const toMaintenanceItemResult = (
  entry: LocalScanEntry,
  result: Awaited<ReturnType<MaintenanceRuntime["applyEntry"]>>,
): MaintenanceItemResult => {
  if (result.status === "failed") {
    return {
      fileId: entry.fileId,
      status: "failed",
      error: result.error,
    };
  }

  return {
    fileId: entry.fileId,
    status: "success",
    crawlerData: result.crawlerData,
    updatedEntry: result.entry,
    fieldDiffs: result.fieldDiffs,
    unchangedFieldDiffs: result.unchangedFieldDiffs,
    pathDiff: result.pathDiff,
  };
};

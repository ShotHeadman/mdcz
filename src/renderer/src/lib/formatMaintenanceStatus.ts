import type { LocalScanEntry, MaintenanceItemResult, MaintenanceStatus } from "@shared/types";
import { formatMaintenanceIdleStatusText, summarizeMaintenanceExecutionGroups } from "@/lib/maintenanceGrouping";

type MaintenanceExecutionStatus = MaintenanceStatus["state"];

const summarizeRawItemResults = (itemResults: Record<string, MaintenanceItemResult>) => {
  let successCount = 0;
  let failedCount = 0;
  let activeCount = 0;

  for (const result of Object.values(itemResults)) {
    if (result.status === "success") {
      successCount += 1;
      continue;
    }

    if (result.status === "failed") {
      failedCount += 1;
      continue;
    }

    activeCount += 1;
  }

  return {
    totalCount: successCount + failedCount + activeCount,
    completedCount: successCount + failedCount,
    successCount,
    failedCount,
    activeCount,
  };
};

export const formatMaintenanceStatus = (
  status: MaintenanceStatus,
  entries: LocalScanEntry[],
  itemResults: Record<string, MaintenanceItemResult>,
  previousText: string,
  previousExecutionStatus: MaintenanceExecutionStatus,
): string => {
  const wasStopping = previousExecutionStatus === "stopping" || previousText.startsWith("已停止");
  const wasExecuting = previousExecutionStatus === "executing" || previousText.startsWith("执行完成");
  const localSummary =
    entries.length > 0
      ? summarizeMaintenanceExecutionGroups(entries, itemResults)
      : summarizeRawItemResults(itemResults);
  const hasTerminalLocalSummary = localSummary.totalCount > 0 && localSummary.activeCount === 0;

  if (status.state === "scanning") {
    return "正在扫描目录...";
  }

  if (status.state === "executing") {
    return localSummary.totalCount > 0
      ? `已完成 ${localSummary.completedCount}/${localSummary.totalCount} · 成功 ${localSummary.successCount} · 失败 ${localSummary.failedCount}`
      : `已完成 ${status.completedEntries}/${status.totalEntries} · 成功 ${status.successCount} · 失败 ${status.failedCount}`;
  }

  if (status.state === "stopping") {
    return localSummary.totalCount > 0
      ? `正在停止 · 已完成 ${localSummary.completedCount}/${localSummary.totalCount}`
      : `正在停止 · 已完成 ${status.completedEntries}/${status.totalEntries}`;
  }

  if (wasStopping && (status.totalEntries > 0 || hasTerminalLocalSummary)) {
    return `已停止 · 成功 ${localSummary.successCount} · 失败/取消 ${localSummary.failedCount}`;
  }

  if (status.totalEntries > 0) {
    return localSummary.totalCount > 0
      ? `执行完成 · 成功 ${localSummary.successCount} · 失败 ${localSummary.failedCount}`
      : `执行完成 · 成功 ${status.successCount} · 失败 ${status.failedCount}`;
  }

  if (wasExecuting && hasTerminalLocalSummary) {
    return `执行完成 · 成功 ${localSummary.successCount} · 失败 ${localSummary.failedCount}`;
  }

  if (entries.length > 0) {
    return formatMaintenanceIdleStatusText(entries);
  }

  return previousText || "就绪";
};

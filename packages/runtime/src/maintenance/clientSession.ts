import type {
  MaintenanceActiveSessionSnapshot,
  MaintenanceApplyItemResult,
  MaintenanceTaskPreview,
  MaintenanceTaskStatus,
} from "@mdcz/shared/maintenanceTasks";
import type {
  LocalScanEntry,
  MaintenanceClientSession,
  MaintenanceItemResult,
  MaintenancePreviewItem,
  MaintenanceStatus,
} from "@mdcz/shared/types";

export interface MaintenanceClientSessionHost {
  fileId(preview: MaintenanceTaskPreview, entry: LocalScanEntry | null): string;
  toEntry(preview: MaintenanceTaskPreview, fileId: string): LocalScanEntry | null;
}

const toStatus = (
  taskStatus: MaintenanceTaskStatus,
  phase: "preview" | "apply",
  progress: MaintenanceActiveSessionSnapshot["execution"],
): MaintenanceStatus => ({
  state:
    taskStatus === "paused"
      ? "paused"
      : taskStatus === "stopping"
        ? "stopping"
        : taskStatus === "queued" || taskStatus === "running"
          ? phase === "preview"
            ? "previewing"
            : "executing"
          : "idle",
  totalEntries: progress.totalEntries,
  completedEntries: progress.completedEntries,
  successCount: progress.successCount,
  failedCount: progress.failedCount,
});

const toPreviewItem = (preview: MaintenanceTaskPreview, fileId: string): MaintenancePreviewItem => ({
  fileId,
  previewId: preview.id,
  taskId: preview.taskId,
  status: preview.status === "ready" ? "ready" : "blocked",
  ...(preview.error ? { error: preview.error } : {}),
  ...(preview.fieldDiffs.length > 0 ? { fieldDiffs: preview.fieldDiffs } : {}),
  ...(preview.unchangedFieldDiffs.length > 0 ? { unchangedFieldDiffs: preview.unchangedFieldDiffs } : {}),
  ...(preview.pathDiff ? { pathDiff: preview.pathDiff } : {}),
  ...(preview.proposedCrawlerData ? { proposedCrawlerData: preview.proposedCrawlerData } : {}),
  ...(preview.imageAlternatives ? { imageAlternatives: preview.imageAlternatives } : {}),
});

const resultPreview = (
  taskId: string,
  log: NonNullable<MaintenanceActiveSessionSnapshot["recentBatch"]>["items"][number]["log"],
  result: MaintenanceApplyItemResult,
): MaintenanceTaskPreview => ({
  id: log.previewId,
  taskId,
  rootId: log.rootId,
  relativePath: log.relativePath,
  presetId: log.presetId,
  status: result.status === "success" ? "applied" : "failed",
  error: result.error ?? null,
  fieldDiffs: result.fieldDiffs ?? [],
  unchangedFieldDiffs: result.unchangedFieldDiffs ?? [],
  pathDiff: result.pathDiff ?? null,
  proposedCrawlerData: result.crawlerData ?? null,
  entry: result.entry,
  createdAt: log.appliedAt,
  updatedAt: log.appliedAt,
});

const toRecentResult = (
  taskId: string,
  item: NonNullable<MaintenanceActiveSessionSnapshot["recentBatch"]>["items"][number],
  host: MaintenanceClientSessionHost,
): MaintenanceItemResult => {
  const preview = resultPreview(taskId, item.log, item.result);
  const fileId = host.fileId(preview, item.result.entry ?? null);
  const updatedEntry = host.toEntry(preview, fileId);
  return {
    fileId,
    batchId: item.log.batchId,
    status: item.result.status,
    ...(item.result.error ? { error: item.result.error } : {}),
    ...(item.result.crawlerData ? { crawlerData: item.result.crawlerData } : {}),
    ...(updatedEntry ? { updatedEntry } : {}),
    ...(item.result.fieldDiffs ? { fieldDiffs: item.result.fieldDiffs } : {}),
    ...(item.result.unchangedFieldDiffs ? { unchangedFieldDiffs: item.result.unchangedFieldDiffs } : {}),
    ...(item.result.pathDiff ? { pathDiff: item.result.pathDiff } : {}),
  };
};

export const toMaintenanceClientSession = (
  snapshot: MaintenanceActiveSessionSnapshot | null,
  host: MaintenanceClientSessionHost,
): MaintenanceClientSession | null => {
  if (!snapshot) return null;

  const fileIdByPreviewId = new Map<string, string>();
  const entries: LocalScanEntry[] = [];
  const previewItems = snapshot.previews.map((preview) => {
    const fileId = host.fileId(preview, preview.entry ?? null);
    fileIdByPreviewId.set(preview.id, fileId);
    const entry = host.toEntry(preview, fileId);
    if (entry) entries.push(entry);
    return toPreviewItem(preview, fileId);
  });

  const fieldSelections = Object.fromEntries(
    Object.entries(snapshot.draft.fieldSelections).flatMap(([previewId, selections]) => {
      const fileId = fileIdByPreviewId.get(previewId);
      return fileId ? [[fileId, { ...selections }]] : [];
    }),
  );
  const imageSelections = Object.fromEntries(
    Object.entries(snapshot.draft.imageSelections).flatMap(([previewId, selections]) => {
      const fileId = fileIdByPreviewId.get(previewId);
      return fileId ? [[fileId, { ...selections }]] : [];
    }),
  );
  const currentResults: MaintenanceItemResult[] = snapshot.applyItems.flatMap((item) => {
    if (item.status !== "pending" && item.status !== "processing") return [];
    const fileId = fileIdByPreviewId.get(item.previewId);
    return fileId ? [{ fileId, batchId: item.batchId, status: item.status }] : [];
  });

  return {
    taskId: snapshot.task.id,
    batchId: snapshot.execution.batchId,
    presetId: snapshot.execution.presetId,
    entries,
    preview: { items: previewItems },
    fieldSelections,
    imageSelections,
    status: toStatus(snapshot.task.status, snapshot.execution.phase, snapshot.execution),
    currentResults,
    recentResults: snapshot.recentBatch?.items.map((item) => toRecentResult(snapshot.task.id, item, host)) ?? [],
  };
};

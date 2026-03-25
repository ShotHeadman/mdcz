import type { MaintenancePreviewItem } from "@shared/types";
import { Play, RefreshCw, StopCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { ipc } from "@/client/ipc";
import { getMaintenancePresetMeta, MAINTENANCE_PRESET_OPTIONS } from "@/components/maintenance/presetMeta";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select";
import { buildMaintenanceCommitItem } from "@/lib/maintenance";
import {
  buildMaintenanceEntryGroups,
  countMaintenanceDisplayItems,
  summarizeMaintenancePreviewGroups,
} from "@/lib/maintenanceGrouping";
import { cn } from "@/lib/utils";
import { useMaintenanceStore } from "@/store/maintenanceStore";
import { useScrapeStore } from "@/store/scrapeStore";

interface MaintenanceBatchBarProps {
  mediaPath?: string;
  className?: string;
}

const asMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
};

const formatPreviewStatusText = (readyCount: number, blockedCount: number): string => {
  return blockedCount > 0
    ? `预览完成 · 可执行 ${readyCount} · 阻塞 ${blockedCount}`
    : `预览完成 · 可执行 ${readyCount} 项`;
};

const areEntriesEqual = <T,>(left: T[], right: T[]): boolean => {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
};

const isPreviewGroupReady = (
  group: ReturnType<typeof buildMaintenanceEntryGroups>[number],
  previewResults: Record<string, MaintenancePreviewItem>,
): boolean => {
  const previews = group.items.flatMap((entry) => {
    const preview = previewResults[entry.id];
    return preview ? [preview] : [];
  });

  return previews.length === group.items.length && previews.every((preview) => preview.status === "ready");
};

const buildExecutableEntries = (
  entries: Parameters<typeof buildMaintenanceEntryGroups>[0],
  previewResults: Record<string, MaintenancePreviewItem>,
) =>
  buildMaintenanceEntryGroups(entries).flatMap((group) =>
    isPreviewGroupReady(group, previewResults) ? group.items : [],
  );

export default function MaintenanceBatchBar({ mediaPath, className }: MaintenanceBatchBarProps) {
  const isScraping = useScrapeStore((state) => state.isScraping);
  const {
    entries,
    selectedIds,
    presetId,
    setPresetId,
    executionStatus,
    lastScannedDir,
    currentPath,
    executeDialogOpen,
    previewPending,
    previewResults,
    itemResults,
    setEntries,
    setExecutionStatus,
    setCurrentPath,
    setStatusText,
    setExecuteDialogOpen,
    setPreviewPending,
    applyPreviewResult,
    clearPreviewResults,
    beginExecution,
    rollbackExecutionStart,
  } = useMaintenanceStore(
    useShallow((state) => ({
      entries: state.entries,
      selectedIds: state.selectedIds,
      presetId: state.presetId,
      setPresetId: state.setPresetId,
      executionStatus: state.executionStatus,
      lastScannedDir: state.lastScannedDir,
      currentPath: state.currentPath,
      executeDialogOpen: state.executeDialogOpen,
      previewPending: state.previewPending,
      previewResults: state.previewResults,
      itemResults: state.itemResults,
      setEntries: state.setEntries,
      setExecutionStatus: state.setExecutionStatus,
      setCurrentPath: state.setCurrentPath,
      setStatusText: state.setStatusText,
      setExecuteDialogOpen: state.setExecuteDialogOpen,
      setPreviewPending: state.setPreviewPending,
      applyPreviewResult: state.applyPreviewResult,
      clearPreviewResults: state.clearPreviewResults,
      beginExecution: state.beginExecution,
      rollbackExecutionStart: state.rollbackExecutionStart,
    })),
  );

  const [stopDialogOpen, setStopDialogOpen] = useState(false);

  const presetMeta = getMaintenancePresetMeta(presetId);
  const supportsExecution = presetMeta.supportsExecution !== false;
  const usesDiffView = presetId === "refresh_data" || presetId === "rebuild_all";
  const executing = executionStatus === "executing" || executionStatus === "stopping";
  const scanning = executionStatus === "scanning";
  const hasPreviewResults = Object.keys(previewResults).length > 0;
  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedIds.includes(entry.id)),
    [entries, selectedIds],
  );
  const groupedSelectedEntries = useMemo(
    () => buildMaintenanceEntryGroups(selectedEntries, { itemResults, previewResults }),
    [itemResults, previewResults, selectedEntries],
  );
  const entriesCount = useMemo(
    () => countMaintenanceDisplayItems(entries, { itemResults, previewResults }),
    [entries, itemResults, previewResults],
  );
  const selectedCount = useMemo(
    () => countMaintenanceDisplayItems(selectedEntries, { itemResults, previewResults }),
    [itemResults, previewResults, selectedEntries],
  );
  const previewSummary = useMemo(
    () => summarizeMaintenancePreviewGroups(selectedEntries, previewResults),
    [selectedEntries, previewResults],
  );
  const previewActionLabel = previewPending
    ? "正在预览..."
    : usesDiffView
      ? hasPreviewResults
        ? "刷新对比"
        : "生成对比"
      : "开始执行";

  const resolveScanDirectory = async (): Promise<string | null> => {
    const preferred = lastScannedDir || mediaPath?.trim() || "";
    if (preferred) {
      return preferred;
    }

    const selection = await ipc.file.browse("directory");
    const path = selection.paths?.[0]?.trim();
    return path || null;
  };

  const handleScan = async () => {
    if (isScraping) {
      toast.warning("正常刮削正在进行中，无法启动维护模式。请先停止当前任务。");
      return;
    }

    const dirPath = await resolveScanDirectory();
    if (!dirPath) {
      toast.info("未选择维护目录");
      return;
    }

    setExecutionStatus("scanning");
    setCurrentPath(dirPath);
    setStatusText("正在扫描目录...");

    try {
      const result = await ipc.maintenance.scan(dirPath);
      setEntries(result.entries, dirPath);
      toast.success(`扫描完成，共发现 ${countMaintenanceDisplayItems(result.entries)} 个项目`);
    } catch (error) {
      setExecutionStatus("idle");
      setCurrentPath(dirPath);
      setStatusText("扫描失败");
      toast.error(`扫描失败: ${asMessage(error)}`);
    }
  };

  const handlePreview = async () => {
    if (!supportsExecution) {
      return false;
    }

    if (isScraping) {
      toast.warning("正常刮削正在进行中，无法启动维护模式。请先停止当前任务。");
      return false;
    }

    if (selectedEntries.length === 0) {
      toast.info("请先选择要执行的项目");
      return false;
    }

    clearPreviewResults();
    setPreviewPending(true);
    setStatusText(`正在预览 ${countMaintenanceDisplayItems(selectedEntries)} 项...`);
    const requestedPresetId = presetId;
    const requestedEntries = selectedEntries;

    try {
      const preview = await ipc.maintenance.preview(selectedEntries, presetId);
      const liveState = useMaintenanceStore.getState();
      const previewExpired =
        liveState.presetId !== requestedPresetId ||
        !areEntriesEqual(
          liveState.entries.filter((entry) => liveState.selectedIds.includes(entry.id)),
          requestedEntries,
        );

      if (previewExpired) {
        return null;
      }

      applyPreviewResult(preview);
      const previewMap = Object.fromEntries(preview.items.map((item) => [item.entryId, item]));
      const previewSummary = summarizeMaintenancePreviewGroups(requestedEntries, previewMap);
      setStatusText(formatPreviewStatusText(previewSummary.readyCount, previewSummary.blockedCount));
      if (usesDiffView) {
        toast.info(
          previewSummary.readyCount > 0
            ? "预览完成，请在右侧数据对比中确认并进行数据替换。"
            : "预览完成，请在右侧数据对比中查看阻塞项。",
        );
      }
      return preview;
    } catch (error) {
      const liveState = useMaintenanceStore.getState();
      const previewExpired =
        liveState.presetId !== requestedPresetId ||
        !areEntriesEqual(
          liveState.entries.filter((entry) => liveState.selectedIds.includes(entry.id)),
          requestedEntries,
        );

      if (previewExpired) {
        return null;
      }

      setPreviewPending(false);
      setStatusText("预览失败");
      clearPreviewResults();
      toast.error(`预览失败: ${asMessage(error)}`);
      return null;
    }
  };

  const handleExecute = async (previewMapOverride?: Record<string, MaintenancePreviewItem>) => {
    if (!supportsExecution) {
      toast.info("“读取本地”预设只需扫描目录，无需执行。");
      return;
    }

    if (isScraping) {
      toast.warning("正常刮削正在进行中，无法启动维护模式。请先停止当前任务。");
      return;
    }

    const liveState = useMaintenanceStore.getState();
    const effectivePreviewResults = previewMapOverride ?? liveState.previewResults;
    const effectiveFieldSelections = liveState.fieldSelections;
    const latestSelectedEntries = liveState.entries.filter((entry) => liveState.selectedIds.includes(entry.id));
    const executableEntries = buildExecutableEntries(latestSelectedEntries, effectivePreviewResults);
    const commitItems = executableEntries.map((entry) =>
      buildMaintenanceCommitItem(entry, effectivePreviewResults[entry.id], effectiveFieldSelections[entry.id]),
    );

    if (commitItems.length === 0) {
      toast.info("没有可执行的项目，请先完成预览并处理阻塞项。");
      return;
    }

    beginExecution(commitItems.map((item) => item.entry.id));
    setCurrentPath(commitItems[0]?.entry.videoPath ?? currentPath);
    setStatusText(`正在执行 ${countMaintenanceDisplayItems(commitItems.map((item) => item.entry))} 项...`);

    try {
      await ipc.maintenance.execute(commitItems, presetId);
      toast.success(`维护任务已启动，共 ${countMaintenanceDisplayItems(commitItems.map((item) => item.entry))} 项`);
    } catch (error) {
      rollbackExecutionStart();
      setStatusText("启动失败");
      toast.error(`启动失败: ${asMessage(error)}`);
    }
  };

  const handleStop = async () => {
    try {
      await ipc.maintenance.stop();
      setExecutionStatus("stopping");
      setStatusText("正在停止维护操作...");
      toast.info("正在停止维护操作...");
    } catch (error) {
      toast.error(`停止失败: ${asMessage(error)}`);
    }
  };

  return (
    <div className={cn("flex flex-col items-end gap-1.5", className)}>
      <div className="flex flex-wrap items-start justify-end gap-2">
        <div className="flex flex-col gap-1.5">
          <div className="flex h-9 items-center gap-2 rounded-lg border bg-background px-3">
            <span className="text-xs font-medium text-muted-foreground">预设</span>
            <Select
              value={presetId}
              onValueChange={(value) => setPresetId(value as typeof presetId)}
              disabled={executing}
            >
              <SelectTrigger className="border-0 bg-transparent px-0 shadow-none focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MAINTENANCE_PRESET_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {!executing && entriesCount > 0 && (
          <div className="hidden h-9 items-center rounded-lg border bg-background px-3 text-xs text-muted-foreground xl:flex">
            已选 {selectedCount}/{entriesCount}
          </div>
        )}

        {!executing ? (
          <>
            <Button
              variant="outline"
              onClick={handleScan}
              disabled={isScraping || scanning}
              className="h-9 rounded-lg px-4"
            >
              <RefreshCw className={cn("mr-2 h-4 w-4", scanning && "animate-spin")} />
              {entriesCount > 0 ? "重新扫描" : "扫描目录"}
            </Button>
            {supportsExecution && (
              <Button
                onClick={async () => {
                  const preview = await handlePreview();
                  if (preview && !usesDiffView) {
                    const previewMap = Object.fromEntries(preview.items.map((item) => [item.entryId, item]));
                    void handleExecute(previewMap);
                  }
                }}
                disabled={isScraping || scanning || previewPending || entriesCount === 0 || selectedCount === 0}
                className="h-9 rounded-lg px-4"
              >
                {previewPending ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                {previewActionLabel}
              </Button>
            )}
            {usesDiffView && (
              <Button
                variant="secondary"
                onClick={() => setExecuteDialogOpen(true)}
                disabled={previewPending || !hasPreviewResults || previewSummary.readyCount === 0}
                className="h-9 rounded-lg px-4"
              >
                数据替换
              </Button>
            )}
          </>
        ) : (
          <Button variant="destructive" onClick={() => setStopDialogOpen(true)} className="h-9 rounded-lg px-4">
            <StopCircle className="mr-2 h-4 w-4" />
            停止执行
          </Button>
        )}
      </div>
      <div className="flex justify-end px-1 text-[11px] leading-4 text-muted-foreground">{presetMeta.description}</div>

      <Dialog open={usesDiffView && executeDialogOpen} onOpenChange={setExecuteDialogOpen}>
        <DialogContent className="max-w-xl min-w-0 overflow-hidden sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>确认数据替换</DialogTitle>
            <DialogDescription>这里会按当前预览结果，对已选条目批量写入元数据、图片和文件调整。</DialogDescription>
          </DialogHeader>
          {previewPending ? (
            <div className="space-y-3 py-2 text-sm text-muted-foreground">
              <div>正在分析本次维护将要修改的内容...</div>
            </div>
          ) : (
            <div className="min-w-0 space-y-4 text-sm">
              <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
                <span className="text-muted-foreground">预设</span>
                <span className="min-w-0 break-words">{presetMeta.label}</span>
                <span className="text-muted-foreground">选中</span>
                <span>
                  {selectedCount} / {entriesCount} 项
                </span>
                <span className="text-muted-foreground">可执行</span>
                <span>{previewSummary.readyCount} 项</span>
                <span className="text-muted-foreground">阻塞</span>
                <span>{previewSummary.blockedCount} 项</span>
              </div>

              <div className="space-y-2">
                <div className="text-muted-foreground">此操作将:</div>
                <div className="space-y-1 min-w-0">
                  {presetMeta.executeSummary.map((line) => (
                    <div key={line} className="break-words">
                      · {line}
                    </div>
                  ))}
                </div>
              </div>

              <div className="max-h-72 min-w-0 space-y-2 overflow-x-hidden overflow-y-auto rounded-xl border p-3">
                {groupedSelectedEntries.map((group) => {
                  const previews = group.items.flatMap((entry) => {
                    const preview = previewResults[entry.id];
                    return preview ? [preview] : [];
                  });
                  const blockedPreview = previews.find((preview) => preview.status === "blocked");
                  const ready = isPreviewGroupReady(group, previewResults);
                  const diffCount = Math.max(0, ...previews.map((preview) => preview.fieldDiffs?.length ?? 0));
                  const changedPathItems = group.items.flatMap((entry) => {
                    const preview = previewResults[entry.id];
                    return preview?.pathDiff?.changed ? [{ entry, pathDiff: preview.pathDiff }] : [];
                  });
                  const hasPathChange = changedPathItems.length > 0;

                  return (
                    <div key={group.id} className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{group.representative.fileInfo.number}</div>
                          <div className="break-all text-xs text-muted-foreground">
                            {group.representative.crawlerData?.title_zh ??
                              group.representative.crawlerData?.title ??
                              group.representative.fileInfo.fileName}
                          </div>
                        </div>
                        <div
                          className={
                            !ready
                              ? "shrink-0 whitespace-nowrap text-xs font-medium text-destructive"
                              : "shrink-0 whitespace-nowrap text-xs font-medium text-emerald-600"
                          }
                        >
                          {ready ? "可执行" : "阻塞"}
                        </div>
                      </div>

                      {!ready ? (
                        <div className="mt-2 break-all text-xs text-destructive">
                          {blockedPreview?.error ?? "部分分盘文件无法完成预览"}
                        </div>
                      ) : (
                        <>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span>字段差异 {diffCount} 项</span>
                            {hasPathChange && <span>路径将调整</span>}
                            {!hasPathChange && diffCount === 0 && <span>无额外变更</span>}
                          </div>
                          {hasPathChange && (
                            <div className="mt-3 space-y-2">
                              {changedPathItems.map(({ entry, pathDiff }) => (
                                <div key={entry.id} className="rounded-md border bg-background/50 p-2">
                                  <div className="mb-2 text-[11px] font-medium text-muted-foreground">
                                    {entry.fileInfo.fileName}
                                  </div>
                                  <div className="grid gap-2 sm:grid-cols-2">
                                    <div className="min-w-0 rounded-md border bg-background/70 p-2">
                                      <div className="mb-1 text-[11px] font-medium text-muted-foreground">当前路径</div>
                                      <div className="break-all font-mono text-[11px] leading-relaxed">
                                        {pathDiff.currentVideoPath}
                                      </div>
                                    </div>
                                    <div className="min-w-0 rounded-md border border-primary/20 bg-primary/5 p-2">
                                      <div className="mb-1 text-[11px] font-medium text-muted-foreground">目标路径</div>
                                      <div className="break-all font-mono text-[11px] leading-relaxed">
                                        {pathDiff.targetVideoPath}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setExecuteDialogOpen(false)}>
              取消
            </Button>
            <Button
              disabled={previewPending || previewSummary.readyCount === 0}
              onClick={() => {
                setExecuteDialogOpen(false);
                void handleExecute();
              }}
            >
              {previewSummary.readyCount === 0 ? "无可执行项" : `开始批量执行 ${previewSummary.readyCount} 项`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={stopDialogOpen} onOpenChange={setStopDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>停止维护操作</DialogTitle>
            <DialogDescription>确定要停止当前维护操作吗？已完成的项目不受影响。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStopDialogOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setStopDialogOpen(false);
                void handleStop();
              }}
            >
              确定停止
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { toErrorMessage } from "@mdcz/shared/error";
import type { MaintenancePreviewItem } from "@mdcz/shared/types";
import { PauseCircle, Play, StopCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { ipc } from "@/client/ipc";
import { getMaintenancePresetMeta } from "@/components/maintenance/presetMeta";
import { ReturnToWorkbenchSetupButton } from "@/components/shared/ReturnToWorkbenchSetupButton";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Progress } from "@/components/ui/Progress";
import { buildMaintenanceCommitItem } from "@/lib/maintenance";
import { buildMaintenanceEntryViewModel } from "@/lib/maintenanceGrouping";
import { cn } from "@/lib/utils";
import { useMaintenanceEntryStore } from "@/store/maintenanceEntryStore";
import { useMaintenanceExecutionStore } from "@/store/maintenanceExecutionStore";
import { useMaintenancePreviewStore } from "@/store/maintenancePreviewStore";
import {
  applyMaintenancePreviewResult,
  beginMaintenanceExecution,
  beginMaintenancePreviewRequest,
  cancelMaintenancePreviewFlow,
  resetMaintenanceSession,
  setMaintenancePreviewPending,
} from "@/store/maintenanceSession";
import { useScrapeStore } from "@/store/scrapeStore";

interface MaintenanceBatchBarProps {
  className?: string;
  mediaPath?: string;
}

const areEntriesEqual = <T,>(left: T[], right: T[]): boolean => {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
};

export default function MaintenanceBatchBar({ className }: MaintenanceBatchBarProps) {
  const isScraping = useScrapeStore((state) => state.isScraping);
  const { entries, selectedIds, presetId, currentPath, setCurrentPath } = useMaintenanceEntryStore(
    useShallow((state) => ({
      entries: state.entries,
      selectedIds: state.selectedIds,
      presetId: state.presetId,
      currentPath: state.currentPath,
      setCurrentPath: state.setCurrentPath,
    })),
  );
  const { executionStatus, progressValue, itemResults, setExecutionStatus, setProgress, rollbackExecutionStart } =
    useMaintenanceExecutionStore(
      useShallow((state) => ({
        executionStatus: state.executionStatus,
        progressValue: state.progressValue,
        itemResults: state.itemResults,
        setExecutionStatus: state.setExecutionStatus,
        setProgress: state.setProgress,
        rollbackExecutionStart: state.rollbackExecutionStart,
      })),
    );
  const { previewPending, previewResults, fieldSelections, executeDialogOpen, setExecuteDialogOpen } =
    useMaintenancePreviewStore(
      useShallow((state) => ({
        previewPending: state.previewPending,
        previewResults: state.previewResults,
        fieldSelections: state.fieldSelections,
        executeDialogOpen: state.executeDialogOpen,
        setExecuteDialogOpen: state.setExecuteDialogOpen,
      })),
    );

  const [stopDialogOpen, setStopDialogOpen] = useState(false);

  const presetMeta = getMaintenancePresetMeta(presetId);
  const supportsExecution = presetMeta.supportsExecution !== false;
  const usesDiffView = presetId === "refresh_data" || presetId === "rebuild_all";
  const activeExecution = executionStatus !== "idle";
  const paused = executionStatus === "paused";
  const stopping = executionStatus === "stopping";
  const scanning = executionStatus === "scanning";
  const previewing = executionStatus === "previewing";
  const canPauseMaintenance =
    executionStatus === "previewing" || executionStatus === "executing" || executionStatus === "paused";
  const hasPreviewResults = Object.keys(previewResults).length > 0;
  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedIds.includes(entry.fileId)),
    [entries, selectedIds],
  );
  const allEntriesViewModel = useMemo(
    () => buildMaintenanceEntryViewModel(entries, { itemResults, previewResults }),
    [entries, itemResults, previewResults],
  );
  const selectedEntriesViewModel = useMemo(
    () => buildMaintenanceEntryViewModel(selectedEntries, { itemResults, previewResults }),
    [itemResults, previewResults, selectedEntries],
  );
  const groupedSelectedEntries = selectedEntriesViewModel.groups;
  const entriesCount = allEntriesViewModel.displayCount;
  const selectedCount = selectedEntriesViewModel.displayCount;
  const previewSummary = selectedEntriesViewModel.previewSummary;
  const canReturnToSetup = !scanning && !previewPending;
  const previewActionLabel = usesDiffView
    ? hasPreviewResults
      ? "刷新对比"
      : "生成对比"
    : hasPreviewResults
      ? "执行整理"
      : "生成整理预览";

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

    beginMaintenancePreviewRequest();
    setExecutionStatus("previewing");
    setProgress(0, 0, selectedEntries.length);
    const requestedPresetId = presetId;
    const requestedEntries = selectedEntries;

    try {
      const preview = await ipc.maintenance.preview(selectedEntries, presetId);
      const liveState = useMaintenanceEntryStore.getState();
      const previewExpired =
        liveState.presetId !== requestedPresetId ||
        !areEntriesEqual(
          liveState.entries.filter((entry) => liveState.selectedIds.includes(entry.fileId)),
          requestedEntries,
        );

      if (previewExpired) {
        return null;
      }

      applyMaintenancePreviewResult(preview);
      setExecutionStatus("idle");
      if (usesDiffView) {
        const previewMap = Object.fromEntries(preview.items.map((item) => [item.fileId, item]));
        const nextPreviewSummary = buildMaintenanceEntryViewModel(requestedEntries, {
          previewResults: previewMap,
        }).previewSummary;
        toast.info(
          nextPreviewSummary.readyCount > 0
            ? "预览完成，请在右侧数据对比中确认并进行数据替换。"
            : "预览完成，请在右侧数据对比中查看阻塞项。",
        );
      }
      return preview;
    } catch (error) {
      const liveState = useMaintenanceEntryStore.getState();
      const previewExpired =
        liveState.presetId !== requestedPresetId ||
        !areEntriesEqual(
          liveState.entries.filter((entry) => liveState.selectedIds.includes(entry.fileId)),
          requestedEntries,
        );

      if (previewExpired) {
        return null;
      }

      setMaintenancePreviewPending(false);
      if (toErrorMessage(error) === "Operation aborted") {
        cancelMaintenancePreviewFlow();
        return null;
      }

      setExecutionStatus("idle");
      toast.error(`预览失败: ${toErrorMessage(error)}`);
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

    const liveEntryState = useMaintenanceEntryStore.getState();
    const effectivePreviewResults = previewMapOverride ?? previewResults;
    const latestSelectedEntries = liveEntryState.entries.filter((entry) =>
      liveEntryState.selectedIds.includes(entry.fileId),
    );
    const executionViewModel = buildMaintenanceEntryViewModel(latestSelectedEntries, {
      previewResults: effectivePreviewResults,
    });
    const executableEntries = executionViewModel.executableEntries;
    const commitItems = executableEntries.map((entry) =>
      buildMaintenanceCommitItem(entry, effectivePreviewResults[entry.fileId], fieldSelections[entry.fileId]),
    );

    if (commitItems.length === 0) {
      toast.info("没有可执行的项目，请先完成预览并处理阻塞项。");
      return;
    }

    const displayCount = buildMaintenanceEntryViewModel(executableEntries).displayCount;
    beginMaintenanceExecution(commitItems.map((item) => item.entry.fileId));
    setCurrentPath(commitItems[0]?.entry.fileInfo.filePath ?? currentPath);

    try {
      await ipc.maintenance.execute(commitItems, presetId);
      toast.success(`维护任务已启动，共 ${displayCount} 项`);
    } catch (error) {
      rollbackExecutionStart();
      toast.error(`启动失败: ${toErrorMessage(error)}`);
    }
  };

  const handlePauseToggle = async () => {
    if (!canPauseMaintenance) {
      return;
    }

    try {
      const pausingPreview = previewing;
      if (paused) {
        await ipc.maintenance.resume();
        setExecutionStatus(previewPending ? "previewing" : "executing");
        toast.success(previewPending ? "维护预览已恢复" : "维护任务已恢复");
        return;
      }

      await ipc.maintenance.pause();
      setExecutionStatus("paused");
      toast.info(pausingPreview ? "维护预览已暂停" : "维护任务已暂停");
    } catch (error) {
      toast.error(`${paused ? "恢复" : "暂停"}失败: ${toErrorMessage(error)}`);
    }
  };

  const handleStop = async () => {
    try {
      await ipc.maintenance.stop();
      setExecutionStatus("stopping");
      toast.info("正在停止维护流程...");
    } catch (error) {
      toast.error(`停止失败: ${toErrorMessage(error)}`);
    }
  };

  const handleReturnToSetup = () => {
    setExecuteDialogOpen(false);
    resetMaintenanceSession();
  };

  return (
    <>
      <div className={cn("flex w-fit max-w-full flex-wrap items-center justify-center gap-2", className)}>
        {!activeExecution ? (
          <>
            <ReturnToWorkbenchSetupButton
              disabled={!canReturnToSetup}
              dialogDescription="返回后会清空当前维护列表、预览结果和执行记录。确定继续吗？"
              onConfirm={handleReturnToSetup}
            />
            {supportsExecution && (
              <Button
                onClick={async () => {
                  if (!usesDiffView && hasPreviewResults) {
                    await handleExecute();
                    return;
                  }

                  const preview = await handlePreview();
                  if (preview && !usesDiffView) {
                    toast.info("预览完成，请在右侧路径计划中确认后执行。");
                  }
                }}
                disabled={isScraping || scanning || previewPending || entriesCount === 0 || selectedCount === 0}
                className="h-9 rounded-lg px-4"
              >
                <Play className="mr-2 h-4 w-4" />
                {previewActionLabel}
              </Button>
            )}
            {usesDiffView && (
              <Button
                variant="secondary"
                onClick={() => setExecuteDialogOpen(true)}
                disabled={scanning || previewPending || !hasPreviewResults || previewSummary.readyCount === 0}
                className="h-9 rounded-lg px-4"
              >
                数据替换
              </Button>
            )}
          </>
        ) : (
          <>
            <div className="flex min-w-44 items-center gap-3 px-1">
              <Progress value={progressValue} className="h-1.5 w-28 md:w-36" />
              <span className="w-10 font-numeric text-[11px] font-bold tabular-nums text-foreground">
                {Math.round(progressValue)}%
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-quiet-capsule"
              onClick={handlePauseToggle}
              disabled={!canPauseMaintenance || stopping}
              aria-label={paused ? "恢复维护操作" : "暂停维护操作"}
              title={paused ? "恢复" : "暂停"}
            >
              {paused ? <Play className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="icon-sm"
              className="rounded-quiet-capsule"
              onClick={() => setStopDialogOpen(true)}
              disabled={stopping}
              aria-label="停止维护操作"
              title="停止"
            >
              <StopCircle className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

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
                <span className="min-w-0 wrap-break-word">{presetMeta.label}</span>
                <span className="text-muted-foreground">选中</span>
                <span>
                  {selectedCount} / {entriesCount} 项
                </span>
                <span className="text-muted-foreground">可执行</span>
                <span>{previewSummary.readyCount} 项</span>
                <span className="text-muted-foreground">阻塞</span>
                <span>{previewSummary.blockedCount} 项</span>
              </div>

              <div className="max-h-72 min-w-0 space-y-2 overflow-x-hidden overflow-y-auto rounded-xl border p-3">
                {groupedSelectedEntries.map((group) => {
                  const { blockedPreview, changedPathItems, diffCount, hasPathChange, ready } = group.previewState;

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
                                <div key={entry.fileId} className="rounded-md border bg-background/50 p-2">
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
            <DialogDescription>确定要停止当前维护流程吗？已完成的项目不受影响。</DialogDescription>
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
    </>
  );
}

import { toErrorMessage } from "@mdcz/shared/error";
import type { MaintenancePreviewItem } from "@mdcz/shared/types";
import { type MaintenanceBatchBarPreviewGroup, MaintenanceBatchBarView } from "@mdcz/views/maintenance";
import { useMemo } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { ipc } from "@/client/ipc";
import { getMaintenancePresetMeta } from "@/components/maintenance/presetMeta";
import { buildMaintenanceCommitItem } from "@/lib/maintenance";
import { buildMaintenanceEntryViewModel } from "@/lib/maintenanceGrouping";
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
  mediaPath?: string;
}

const areEntriesEqual = <T,>(left: T[], right: T[]): boolean => {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
};

export default function MaintenanceBatchBar(_props: MaintenanceBatchBarProps) {
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
  const entriesCount = allEntriesViewModel.displayCount;
  const selectedCount = selectedEntriesViewModel.displayCount;
  const previewSummary = selectedEntriesViewModel.previewSummary;
  const canReturnToSetup = !scanning && !previewPending;
  const groupedSelectedEntries = useMemo<MaintenanceBatchBarPreviewGroup[]>(
    () =>
      selectedEntriesViewModel.groups.map((group) => ({
        id: group.id,
        title: group.representative.fileInfo.number,
        subtitle:
          group.representative.crawlerData?.title_zh ??
          group.representative.crawlerData?.title ??
          group.representative.fileInfo.fileName,
        ready: group.previewState.ready,
        blockedError: group.previewState.blockedPreview?.error,
        diffCount: group.previewState.diffCount,
        hasPathChange: group.previewState.hasPathChange,
        changedPathItems: group.previewState.changedPathItems.map(({ entry, pathDiff }) => ({
          fileId: entry.fileId,
          fileName: entry.fileInfo.fileName,
          pathDiff,
        })),
      })),
    [selectedEntriesViewModel.groups],
  );

  const handlePreview = async (): Promise<MaintenancePreviewItem[] | null> => {
    if (!supportsExecution) {
      return null;
    }

    if (isScraping) {
      toast.warning("正常刮削正在进行中，无法启动维护模式。请先停止当前任务。");
      return null;
    }

    if (selectedEntries.length === 0) {
      toast.info("请先选择要执行的项目");
      return null;
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
      } else {
        toast.info("预览完成，请在右侧路径计划中确认后执行。");
      }
      return preview.items;
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
    <MaintenanceBatchBarView
      activeExecution={activeExecution}
      canPauseMaintenance={canPauseMaintenance}
      canReturnToSetup={canReturnToSetup}
      canRunPrimaryAction={!isScraping && !scanning && !previewPending && entriesCount > 0 && selectedCount > 0}
      canRunReplacement={!scanning && !previewPending && hasPreviewResults && previewSummary.readyCount > 0}
      entriesCount={entriesCount}
      executeDialogOpen={executeDialogOpen}
      groupedSelectedEntries={groupedSelectedEntries}
      hasPreviewResults={hasPreviewResults}
      onExecute={() => void handleExecute()}
      onExecuteDialogOpenChange={setExecuteDialogOpen}
      onPauseToggle={() => void handlePauseToggle()}
      onPreview={handlePreview}
      onReturnToSetup={handleReturnToSetup}
      onStop={() => void handleStop()}
      paused={paused}
      presetLabel={presetMeta.label}
      previewPending={previewPending}
      progressValue={progressValue}
      readyCount={previewSummary.readyCount}
      selectedCount={selectedCount}
      stopping={stopping}
      supportsExecution={supportsExecution}
      usesDiffView={usesDiffView}
    />
  );
}

import { toErrorMessage } from "@mdcz/shared/error";
import { getMaintenancePresetMeta } from "@mdcz/shared/maintenancePresets";
import type { MaintenancePreviewItem } from "@mdcz/shared/types";
import { buildMaintenanceEntryViewModel } from "@mdcz/shared/viewModels/maintenanceGrouping";
import {
  resetMaintenanceSession,
  selectMaintenanceEntries,
  selectMaintenanceExecutionStatus,
  selectMaintenanceFieldSelections,
  selectMaintenanceItemResults,
  selectMaintenancePreviewResults,
  selectMaintenanceProgress,
  useMaintenanceStore,
} from "@mdcz/views/state/maintenanceStore";
import { selectIsScraping, useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { type MaintenanceBatchBarPreviewGroup, MaintenanceBatchBarView } from "../maintenance";
import type { MaintenanceActionPort } from "./ports";

export function MaintenanceBatchBarAdapter({ port }: { port: MaintenanceActionPort }) {
  const isScraping = useScrapeStore(selectIsScraping);
  const { entries, selectedIds, presetId, currentPath, setCurrentPath } = useMaintenanceStore(
    useShallow((state) => ({
      entries: selectMaintenanceEntries(state),
      selectedIds: state.selectedIds,
      presetId: state.presetId,
      currentPath: state.currentPath,
      setCurrentPath: state.setCurrentPath,
    })),
  );
  const { executionStatus, progressValue, itemResults, previewPending, previewResults, fieldSelections } =
    useMaintenanceStore(
      useShallow((state) => ({
        executionStatus: selectMaintenanceExecutionStatus(state),
        progressValue: selectMaintenanceProgress(state),
        itemResults: selectMaintenanceItemResults(state),
        previewPending: state.pending,
        previewResults: selectMaintenancePreviewResults(state),
        fieldSelections: selectMaintenanceFieldSelections(state),
      })),
    );
  const [executeDialogOpen, setExecuteDialogOpen] = useState(false);

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

  const handlePreview = async (): Promise<void> => {
    if (!supportsExecution) {
      return;
    }

    if (isScraping) {
      toast.warning("正常刮削正在进行中，无法启动维护模式。请先停止当前任务。");
      return;
    }

    if (selectedEntries.length === 0) {
      toast.info("请先选择要执行的项目");
      return;
    }

    useMaintenanceStore.getState().setPending(true);
    try {
      await port.preview(
        selectedEntries.map((entry) => entry.ref),
        presetId,
      );
      toast.info("维护预览已启动");
    } catch (error) {
      useMaintenanceStore.getState().setPending(false);
      if (toErrorMessage(error) === "Operation aborted") {
        return;
      }
      useMaintenanceStore.getState().setError(toErrorMessage(error));
      toast.error(`预览失败: ${toErrorMessage(error)}`);
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

    const liveEntryState = useMaintenanceStore.getState();
    const effectivePreviewResults = previewMapOverride ?? previewResults;
    const latestSelectedEntries = selectMaintenanceEntries(liveEntryState).filter((entry) =>
      liveEntryState.selectedIds.includes(entry.fileId),
    );
    const executionViewModel = buildMaintenanceEntryViewModel(latestSelectedEntries, {
      previewResults: effectivePreviewResults,
    });
    const executableEntries = executionViewModel.executableEntries;
    const selections = executableEntries.map((entry) => {
      const preview = effectivePreviewResults[entry.fileId];
      if (!preview?.previewId) throw new Error(`维护预览缺少 ID：${entry.fileInfo.filePath}`);
      return { previewId: preview.previewId, fieldSelections: fieldSelections[entry.fileId] };
    });

    if (selections.length === 0) {
      toast.info("没有可执行的项目，请先完成预览并处理阻塞项。");
      return;
    }

    const displayCount = buildMaintenanceEntryViewModel(executableEntries).displayCount;
    useMaintenanceStore.getState().setPending(true);
    setCurrentPath(executableEntries[0]?.fileInfo.filePath ?? currentPath);

    try {
      await port.execute(selections, presetId);
      toast.success(`维护任务已启动，共 ${displayCount} 项`);
    } catch (error) {
      useMaintenanceStore.getState().setError(toErrorMessage(error));
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
        await port.resume();
        toast.success(previewPending ? "维护预览已恢复" : "维护任务已恢复");
        return;
      }

      await port.pause();
      toast.info(pausingPreview ? "维护预览已暂停" : "维护任务已暂停");
    } catch (error) {
      toast.error(`${paused ? "恢复" : "暂停"}失败: ${toErrorMessage(error)}`);
    }
  };

  const handleStop = async () => {
    try {
      await port.stop();
      useMaintenanceStore.getState().setPending(true);
      toast.info("正在停止维护流程...");
    } catch (error) {
      toast.error(`停止失败: ${toErrorMessage(error)}`);
    }
  };

  const handleReturnToSetup = async () => {
    try {
      await port.discardSession();
      setExecuteDialogOpen(false);
      resetMaintenanceSession();
    } catch (error) {
      toast.error(`丢弃维护会话失败: ${toErrorMessage(error)}`);
    }
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
      onReturnToSetup={() => void handleReturnToSetup()}
      onStop={() => void handleStop()}
      paused={paused}
      presetLabel={presetMeta.label}
      previewPending={previewPending}
      progressValue={progressValue}
      readyCount={previewSummary.readyCount}
      recentResults={Object.values(itemResults)}
      selectedCount={selectedCount}
      stopping={stopping}
      supportsExecution={supportsExecution}
      usesDiffView={usesDiffView}
    />
  );
}

export default MaintenanceBatchBarAdapter;

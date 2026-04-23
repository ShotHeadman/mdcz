import { toErrorMessage } from "@shared/error";
import type { MaintenancePresetId } from "@shared/types";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { pauseScrape, resumeScrape, retryScrapeSelection, startSelectedScrape, stopScrape } from "@/api/manual";
import { ipc } from "@/client/ipc";
import { isMediaDirectorySelectionCancelled } from "@/client/mediaPath";
import { UncensoredConfirmDialog } from "@/components/UncensoredConfirmDialog";
import WorkbenchSetup from "@/components/workbench/WorkbenchSetup";
import { CURRENT_CONFIG_QUERY_KEY, useCurrentConfig } from "@/hooks/useCurrentConfig";
import { buildMaintenanceEntryViewModel, countMaintenanceDisplayItems } from "@/lib/maintenanceGrouping";
import { buildAmbiguousUncensoredScrapeGroups } from "@/lib/scrapeResultGrouping";
import { useMaintenanceEntryStore } from "@/store/maintenanceEntryStore";
import { useMaintenanceExecutionStore } from "@/store/maintenanceExecutionStore";
import { useMaintenancePreviewStore } from "@/store/maintenancePreviewStore";
import {
  applyMaintenancePreviewResult,
  applyMaintenanceScanResult,
  beginMaintenancePreviewRequest,
  changeMaintenancePreset,
  setMaintenancePreviewPending,
} from "@/store/maintenanceSession";
import { useScrapeStore } from "@/store/scrapeStore";
import { useUIStore } from "@/store/uiStore";

const ScrapeWorkbench = lazy(() => import("@/components/maintenance/ScrapeWorkbench"));
const MaintenanceWorkbench = lazy(() => import("@/components/maintenance/MaintenanceWorkbench"));

export const Route = createFileRoute("/")({
  validateSearch: (search): { intent?: "maintenance" } => ({
    intent: search.intent === "maintenance" ? "maintenance" : undefined,
  }),
  component: Index,
});

function Index() {
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const [uncensoredDialogOpen, setUncensoredDialogOpen] = useState(false);
  const configQ = useCurrentConfig();

  const { isScraping, scrapeStatus, results, setScraping, setScrapeStatus, updateProgress, clearResults } =
    useScrapeStore(
      useShallow((state) => ({
        isScraping: state.isScraping,
        scrapeStatus: state.scrapeStatus,
        results: state.results,
        setScraping: state.setScraping,
        setScrapeStatus: state.setScrapeStatus,
        updateProgress: state.updateProgress,
        clearResults: state.clearResults,
      })),
    );
  const maintenanceStatus = useMaintenanceExecutionStore((state) => state.executionStatus);
  const maintenanceEntries = useMaintenanceEntryStore((state) => state.entries);
  const maintenancePreviewResults = useMaintenancePreviewStore((state) => state.previewResults);
  const maintenanceItemResults = useMaintenanceExecutionStore((state) => state.itemResults);
  const { workbenchMode, setWorkbenchMode, setSelectedResultId } = useUIStore(
    useShallow((state) => ({
      workbenchMode: state.workbenchMode,
      setWorkbenchMode: state.setWorkbenchMode,
      setSelectedResultId: state.setSelectedResultId,
    })),
  );

  const maintenanceBusy = maintenanceStatus !== "idle";
  const ambiguousItems = useMemo(() => buildAmbiguousUncensoredScrapeGroups(results), [results]);
  const failedPaths = useMemo(
    () => results.filter((result) => result.status === "failed").map((result) => result.fileInfo.filePath),
    [results],
  );
  const mediaPath = configQ.data?.paths?.mediaPath?.trim() ?? "";
  const scrapeHasWork = isScraping || scrapeStatus !== "idle" || results.length > 0;
  const maintenanceHasWork =
    maintenanceStatus !== "idle" ||
    maintenanceEntries.length > 0 ||
    Object.keys(maintenancePreviewResults).length > 0 ||
    Object.keys(maintenanceItemResults).length > 0;
  const showSetup = workbenchMode === "maintenance" ? !maintenanceHasWork : !scrapeHasWork;

  // Detect scrape completion and check for ambiguous uncensored items
  const prevScrapeStatusRef = useRef(scrapeStatus);
  useEffect(() => {
    const prev = prevScrapeStatusRef.current;
    prevScrapeStatusRef.current = scrapeStatus;

    if ((prev === "running" || prev === "stopping") && scrapeStatus === "idle" && ambiguousItems.length > 0) {
      setUncensoredDialogOpen(true);
    }
  }, [ambiguousItems, scrapeStatus]);

  useEffect(() => {
    if (search.intent === "maintenance") {
      if (!isScraping) {
        setWorkbenchMode("maintenance");
      }
      return;
    }

    if (maintenanceHasWork && !scrapeHasWork) {
      setWorkbenchMode("maintenance");
      return;
    }

    if (!maintenanceHasWork && (!scrapeHasWork || workbenchMode === "maintenance")) {
      setWorkbenchMode("scrape");
    }
  }, [isScraping, maintenanceHasWork, scrapeHasWork, search.intent, setWorkbenchMode, workbenchMode]);

  const refreshCurrentConfig = async () => {
    await queryClient.invalidateQueries({ queryKey: CURRENT_CONFIG_QUERY_KEY });
  };

  const persistWorkbenchPaths = async (scanDir: string, targetDir: string) => {
    const currentPaths = configQ.data?.paths;
    if (!currentPaths) {
      throw new Error("配置尚未加载完成");
    }

    await ipc.config.save({
      paths: {
        ...currentPaths,
        mediaPath: scanDir,
        successOutputFolder: targetDir || currentPaths.successOutputFolder,
      },
    });
  };

  const handleStartSelectedScrape = async (filePaths: string[], scanDir: string, targetDir: string) => {
    if (maintenanceBusy) {
      toast.warning("维护模式正在运行中，无法启动正常刮削。请先停止当前维护任务。");
      return;
    }

    try {
      await persistWorkbenchPaths(scanDir, targetDir);
      updateProgress(0, 0);
      clearResults();
      setSelectedResultId(null);
      const response = await startSelectedScrape(filePaths);
      setScraping(true);
      setScrapeStatus("running");
      await refreshCurrentConfig();
      toast.success(response.data.message);
    } catch (error) {
      const errorMessage = toErrorMessage(error);

      if (isMediaDirectorySelectionCancelled(error)) {
        return;
      }

      if (errorMessage.includes("NO_FILES")) {
        toast.info("当前目录中没有需要刮削的媒体文件");
        return;
      }

      toast.error(`启动失败: ${errorMessage}`);
    }
  };

  const handleStartSelectedMaintenance = async (
    filePaths: string[],
    scanDir: string,
    targetDir: string,
    presetId: MaintenancePresetId,
  ) => {
    if (isScraping) {
      toast.warning("正常刮削正在运行中，无法启动维护模式。请先停止当前刮削任务。");
      return;
    }

    const executionStore = useMaintenanceExecutionStore.getState();

    try {
      setWorkbenchMode("maintenance");
      changeMaintenancePreset(presetId);
      await persistWorkbenchPaths(scanDir, targetDir);
      executionStore.setExecutionStatus("scanning");
      executionStore.setStatusText("正在读取选中文件...");

      const scan = await ipc.maintenance.scanFiles(filePaths);
      applyMaintenanceScanResult(scan.entries, scanDir);

      if (scan.entries.length === 0) {
        executionStore.setStatusText("未发现可维护项目");
        toast.info("未发现可维护项目");
        await refreshCurrentConfig();
        return;
      }

      if (presetId === "read_local") {
        executionStore.setStatusText(`本地读取完成 · ${countMaintenanceDisplayItems(scan.entries)} 项`);
        toast.success(`本地读取完成，共 ${countMaintenanceDisplayItems(scan.entries)} 项`);
        await refreshCurrentConfig();
        return;
      }

      executionStore.setExecutionStatus("previewing");
      beginMaintenancePreviewRequest();
      executionStore.setStatusText("正在生成维护预览...");
      const preview = await ipc.maintenance.preview(scan.entries, presetId);
      applyMaintenancePreviewResult(preview);

      const previewMap = Object.fromEntries(preview.items.map((item) => [item.fileId, item]));
      const previewSummary = buildMaintenanceEntryViewModel(scan.entries, {
        previewResults: previewMap,
      }).previewSummary;
      executionStore.setStatusText(
        previewSummary.blockedCount > 0
          ? `预览完成 · 可执行 ${previewSummary.readyCount} · 阻塞 ${previewSummary.blockedCount}`
          : `预览完成 · 可执行 ${previewSummary.readyCount} 项`,
      );
      await refreshCurrentConfig();
      toast.success("维护预览已生成");
    } catch (error) {
      setMaintenancePreviewPending(false);
      executionStore.setExecutionStatus("idle");
      executionStore.setStatusText("启动失败");
      toast.error(`启动失败: ${toErrorMessage(error)}`);
    }
  };

  const handleStopScrape = async () => {
    if (!window.confirm("确定要停止刮削吗？")) return;
    try {
      await stopScrape();
      setScrapeStatus("stopping");
      toast.info("正在停止...");
    } catch (_error) {
      toast.error("停止失败");
    }
  };

  const handlePauseScrape = async () => {
    try {
      await pauseScrape();
      setScrapeStatus("paused");
      toast.info("任务已暂停");
    } catch (_error) {
      toast.error("暂停失败");
    }
  };

  const handleResumeScrape = async () => {
    try {
      await resumeScrape();
      setScrapeStatus("running");
      toast.success("任务已恢复");
    } catch (_error) {
      toast.error("恢复失败");
    }
  };

  const resetForNewTask = () => {
    clearResults();
    updateProgress(0, 0);
    setScraping(true);
    setScrapeStatus("running");
    setSelectedResultId(null);
  };

  const handleRetryFailed = async () => {
    if (failedPaths.length === 0) {
      toast.info("当前没有可重试的失败项目");
      return;
    }

    if (!window.confirm(`确定要批量重试 ${failedPaths.length} 个失败项目吗？`)) {
      return;
    }

    try {
      const result = await retryScrapeSelection(failedPaths, {
        scrapeStatus,
      });
      if (result.data.strategy === "new-task") {
        resetForNewTask();
      }
      toast.success(result.data.message);
    } catch (error) {
      toast.error(`重试失败: ${toErrorMessage(error)}`);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载中...</div>
          }
        >
          {showSetup ? (
            <WorkbenchSetup
              mode={workbenchMode}
              config={configQ.data}
              configLoading={configQ.isLoading}
              onStartScrape={handleStartSelectedScrape}
              onStartMaintenance={handleStartSelectedMaintenance}
            />
          ) : workbenchMode === "scrape" ? (
            <ScrapeWorkbench
              onPauseScrape={handlePauseScrape}
              onResumeScrape={handleResumeScrape}
              onStopScrape={handleStopScrape}
              onRetryFailed={handleRetryFailed}
              failedCount={failedPaths.length}
            />
          ) : (
            <MaintenanceWorkbench mediaPath={mediaPath} />
          )}
        </Suspense>
      </div>

      <UncensoredConfirmDialog
        open={uncensoredDialogOpen && ambiguousItems.length > 0}
        onOpenChange={setUncensoredDialogOpen}
        items={ambiguousItems}
      />
    </div>
  );
}

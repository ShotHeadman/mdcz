import {
  activateNewScrapeTask,
  applyScrapeTaskStatus,
  MaintenanceWorkbenchAdapter,
  ScrapeWorkbenchAdapter,
  startMaintenanceFlow,
  useWorkbenchSessionSnapshot,
} from "@mdcz/shared/adapters";
import { toErrorMessage } from "@mdcz/shared/error";
import { useMaintenanceExecutionStore } from "@mdcz/shared/stores/maintenanceExecutionStore";
import { useScrapeStore } from "@mdcz/shared/stores/scrapeStore";
import { useUIStore } from "@mdcz/shared/stores/uiStore";
import type { MaintenancePresetId } from "@mdcz/shared/types";
import {
  buildAmbiguousUncensoredScrapeGroups,
  buildUncensoredConfirmItemsForScrapeGroups,
  summarizeUncensoredConfirmResultForScrapeGroups,
} from "@mdcz/shared/viewModels/scrapeResultGrouping";
import { UncensoredConfirmDialog, type UncensoredConfirmSelection } from "@mdcz/views/scrape";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { createDesktopWorkbenchPorts } from "@/adapters/ports";
import { pauseScrape, resumeScrape, retryScrapeSelection, startSelectedScrape, stopScrape } from "@/api/manual";
import { ipc } from "@/client/ipc";
import { isMediaDirectorySelectionCancelled } from "@/client/mediaPath";
import WorkbenchSetup from "@/components/workbench/WorkbenchSetup";
import { CURRENT_CONFIG_QUERY_KEY, useCurrentConfig } from "@/hooks/useCurrentConfig";

export const Route = createFileRoute("/workbench")({
  validateSearch: (search): { intent?: "maintenance" } => ({
    intent: search.intent === "maintenance" ? "maintenance" : undefined,
  }),
  component: WorkbenchRoute,
});

export function DesktopWorkbenchRoute({ routeIntent }: { routeIntent?: "maintenance" }) {
  const queryClient = useQueryClient();
  const [uncensoredDialogOpen, setUncensoredDialogOpen] = useState(false);
  const configQ = useCurrentConfig();
  const workbenchPorts = useMemo(() => createDesktopWorkbenchPorts(), []);

  const { isScraping, scrapeStatus, results } = useScrapeStore(
    useShallow((state) => ({
      isScraping: state.isScraping,
      scrapeStatus: state.scrapeStatus,
      results: state.results,
    })),
  );
  const maintenanceStatus = useMaintenanceExecutionStore((state) => state.executionStatus);
  const { workbenchMode, setWorkbenchMode } = useUIStore(
    useShallow((state) => ({
      workbenchMode: state.workbenchMode,
      setWorkbenchMode: state.setWorkbenchMode,
    })),
  );

  const maintenanceBusy = maintenanceStatus !== "idle";
  const ambiguousItems = useMemo(() => buildAmbiguousUncensoredScrapeGroups(results), [results]);
  const ambiguousDialogItems = useMemo(
    () =>
      ambiguousItems.map((group) => ({
        id: group.id,
        ref: {
          rootId: "",
          relativePath: group.display.fileInfo.filePath,
        },
        fileId: group.display.fileId,
        fileName: group.display.fileInfo.fileName,
        number: group.display.fileInfo.number,
        title: group.display.crawlerData?.title_zh ?? group.display.crawlerData?.title ?? null,
        nfoRelativePath: group.display.nfoPath ?? null,
      })),
    [ambiguousItems],
  );
  const failedPaths = useMemo(
    () => results.filter((result) => result.status === "failed").map((result) => result.fileInfo.filePath),
    [results],
  );
  const sessionSnapshot = useWorkbenchSessionSnapshot(workbenchMode, routeIntent);
  const scrapeHasWork = sessionSnapshot.scrapeHasWork;
  const maintenanceHasWork = sessionSnapshot.maintenanceHasWork;
  const showSetup = sessionSnapshot.showSetup;

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
    if (routeIntent === "maintenance") {
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
  }, [isScraping, maintenanceHasWork, routeIntent, scrapeHasWork, setWorkbenchMode, workbenchMode]);

  const refreshCurrentConfig = async () => {
    await queryClient.invalidateQueries({ queryKey: CURRENT_CONFIG_QUERY_KEY });
  };

  const handleStartSelectedScrape = async (filePaths: string[], scanDir: string, targetDir: string) => {
    void scanDir;
    void targetDir;
    if (maintenanceBusy) {
      toast.warning("维护模式正在运行中，无法启动正常刮削。请先停止当前维护任务。");
      return;
    }

    try {
      activateNewScrapeTask();
      const response = await startSelectedScrape(filePaths);
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
    _targetDir: string,
    presetId: MaintenancePresetId,
  ) => {
    if (isScraping) {
      toast.warning("正常刮削正在运行中，无法启动维护模式。请先停止当前刮削任务。");
      return;
    }

    await startMaintenanceFlow({
      filePaths,
      scanDir,
      presetId,
      port: workbenchPorts.maintenance,
      isScraping,
      setWorkbenchMode,
      onRefreshConfig: refreshCurrentConfig,
      toast,
      toErrorMessage,
    });
  };

  const handleStopScrape = async () => {
    if (!window.confirm("确定要停止刮削吗？")) return;
    try {
      await stopScrape();
      applyScrapeTaskStatus("stopping");
      toast.info("正在停止...");
    } catch (_error) {
      toast.error("停止失败");
    }
  };

  const handlePauseScrape = async () => {
    try {
      await pauseScrape();
      applyScrapeTaskStatus("paused");
      toast.info("任务已暂停");
    } catch (_error) {
      toast.error("暂停失败");
    }
  };

  const handleResumeScrape = async () => {
    try {
      await resumeScrape();
      applyScrapeTaskStatus("running");
      toast.success("任务已恢复");
    } catch (_error) {
      toast.error("恢复失败");
    }
  };

  const resetForNewTask = () => {
    activateNewScrapeTask();
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

  const handleConfirmUncensored = async (selections: UncensoredConfirmSelection[]) => {
    const choicesByGroupId = Object.fromEntries(selections.map((selection) => [selection.id, selection.choice]));
    const confirmItems = buildUncensoredConfirmItemsForScrapeGroups(ambiguousItems, choicesByGroupId);

    if (confirmItems.length === 0) {
      toast.info("没有可提交的条目");
      return;
    }

    const result = await ipc.scraper.confirmUncensored(confirmItems);
    const { successCount, failedCount } = summarizeUncensoredConfirmResultForScrapeGroups(ambiguousItems, result.items);

    if (result.updatedCount > 0) {
      useScrapeStore.getState().resolveUncensoredResults(result.items);
    }

    if (failedCount === 0) {
      toast.success(`已更新 ${successCount} 个条目的无码类型`);
      return;
    }

    if (successCount > 0) {
      toast.warning(`成功 ${successCount} 条，失败 ${failedCount} 条`);
      throw new Error(`成功 ${successCount} 条，失败 ${failedCount} 条`);
    }

    toast.error(`成功 0 条，失败 ${failedCount} 条`);
    throw new Error(`成功 0 条，失败 ${failedCount} 条`);
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
            <ScrapeWorkbenchAdapter
              ports={workbenchPorts}
              onPauseScrape={handlePauseScrape}
              onResumeScrape={handleResumeScrape}
              onStopScrape={handleStopScrape}
              onRetryFailed={handleRetryFailed}
              failedCount={failedPaths.length}
            />
          ) : (
            <MaintenanceWorkbenchAdapter ports={workbenchPorts} />
          )}
        </Suspense>
      </div>

      <UncensoredConfirmDialog
        open={uncensoredDialogOpen && ambiguousDialogItems.length > 0}
        onOpenChange={setUncensoredDialogOpen}
        items={ambiguousDialogItems}
        onConfirm={handleConfirmUncensored}
      />
    </div>
  );
}

function WorkbenchRoute() {
  const search = Route.useSearch();
  return <DesktopWorkbenchRoute routeIntent={search.intent} />;
}

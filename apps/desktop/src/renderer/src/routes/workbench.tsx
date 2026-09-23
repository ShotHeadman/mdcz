import type { DirectorySource } from "@mdcz/shared/directoryTasks";
import { toErrorMessage } from "@mdcz/shared/error";
import type { MaintenancePresetId, MediaCandidate } from "@mdcz/shared/types";
import {
  activateNewScrapeTask,
  MaintenanceWorkbenchAdapter,
  ScrapeWorkbenchAdapter,
  startMaintenanceFlow,
  useScrapeTerminalError,
  useWorkbenchSessionSnapshot,
} from "@mdcz/views/adapters";
import { ScrapeStartErrorDialog } from "@mdcz/views/scrape";
import {
  changeMaintenancePreset,
  selectMaintenanceExecutionStatus,
  useMaintenanceStore,
} from "@mdcz/views/state/maintenanceStore";
import { runScrapeRequest, selectIsScraping, selectScrapeResults, useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { useUIStore } from "@mdcz/views/state/uiStore";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { createDesktopWorkbenchPorts } from "@/adapters/ports";
import { pauseScrape, resumeScrape, retryScrapeSelection, startSelectedScrape, stopScrape } from "@/api/manual";
import { ipc } from "@/client/ipc";
import { isMediaDirectorySelectionCancelled } from "@/client/mediaPath";
import ScrapeCompletionDialog from "@/components/workbench/ScrapeCompletionDialog";
import WorkbenchSetup from "@/components/workbench/WorkbenchSetup";
import { CURRENT_CONFIG_QUERY_KEY, useCurrentConfig } from "@/hooks/configQueries";

export const Route = createFileRoute("/workbench")({
  validateSearch: (search): { intent?: "maintenance" } => ({
    intent: search.intent === "maintenance" ? "maintenance" : undefined,
  }),
  component: WorkbenchRoute,
});

export function DesktopWorkbenchRoute({ routeIntent }: { routeIntent?: "maintenance" }) {
  const queryClient = useQueryClient();
  const [startError, setStartError] = useState<unknown>(null);
  const configQ = useCurrentConfig();
  const workbenchPorts = useMemo(() => createDesktopWorkbenchPorts(), []);

  const { isScraping, results } = useScrapeStore(
    useShallow((state) => ({
      isScraping: selectIsScraping(state),
      results: selectScrapeResults(state),
    })),
  );
  const maintenanceStatus = useMaintenanceStore(selectMaintenanceExecutionStatus);
  const { workbenchMode, setWorkbenchMode } = useUIStore(
    useShallow((state) => ({
      workbenchMode: state.workbenchMode,
      setWorkbenchMode: state.setWorkbenchMode,
    })),
  );

  const maintenanceBusy = maintenanceStatus !== "idle";
  const failedPaths = useMemo(
    () =>
      results
        .filter((result) => result.status === "failed" || result.status === "skipped")
        .map((result) => result.relativePath),
    [results],
  );

  useScrapeTerminalError(setStartError);
  const sessionSnapshot = useWorkbenchSessionSnapshot(workbenchMode, routeIntent);
  const showSetup = sessionSnapshot.showSetup;

  useEffect(() => {
    if (sessionSnapshot.workbenchMode !== workbenchMode) {
      setWorkbenchMode(sessionSnapshot.workbenchMode);
    }
  }, [sessionSnapshot.workbenchMode, setWorkbenchMode, workbenchMode]);

  const refreshCurrentConfig = async () => {
    await queryClient.invalidateQueries({ queryKey: CURRENT_CONFIG_QUERY_KEY });
  };

  const handleStartDirectory = async (source: DirectorySource, targetDir: string, presetId: MaintenancePresetId) => {
    try {
      if (workbenchMode === "maintenance") {
        if (isScraping) throw new Error("请先停止当前刮削任务");
        changeMaintenancePreset(presetId);
        useMaintenanceStore.getState().setPending(true);
        await ipc.maintenance.directory(source, presetId, targetDir);
      } else {
        if (maintenanceBusy) throw new Error("请先停止当前维护任务");
        activateNewScrapeTask();
        await ipc.scraper.start({ mode: "directory", source, targetDir });
      }
      toast.success("任务已提交");
    } catch (error) {
      if (workbenchMode === "maintenance") useMaintenanceStore.getState().setPending(false);
      throw error;
    }
  };

  const handleStartSelectedScrape = async (candidates: MediaCandidate[], targetDir: string) => {
    if (maintenanceBusy) {
      toast.warning("维护模式正在运行中，无法启动正常刮削。请先停止当前维护任务。");
      return;
    }

    try {
      const outputRoot = await ipc.mediaRoots.prepareOutputDirectory({ hostPath: targetDir });
      activateNewScrapeTask();
      const response = await startSelectedScrape(
        candidates.map((candidate) => candidate.ref),
        outputRoot.id,
        outputRoot.relativeDirectory,
      );
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

      setStartError(error);
    }
  };

  const handleStartSelectedMaintenance = async (
    candidates: MediaCandidate[],
    presetId: MaintenancePresetId,
    targetDir?: string,
  ) => {
    if (isScraping) {
      toast.warning("正常刮削正在运行中，无法启动维护模式。请先停止当前刮削任务。");
      return;
    }

    await startMaintenanceFlow({
      candidates,
      presetId,
      targetDir,
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
      await runScrapeRequest(stopScrape);
      toast.info("正在停止...");
    } catch (_error) {
      toast.error("停止失败");
    }
  };

  const handlePauseScrape = async () => {
    try {
      await runScrapeRequest(pauseScrape);
      toast.info("任务已暂停");
    } catch (_error) {
      toast.error("暂停失败");
    }
  };

  const handleResumeScrape = async () => {
    try {
      await runScrapeRequest(resumeScrape);
      toast.success("任务已恢复");
    } catch (_error) {
      toast.error("恢复失败");
    }
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
      const result = await retryScrapeSelection();
      toast.success(result.data.message);
    } catch (error) {
      setStartError(error);
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
              onStartDirectory={handleStartDirectory}
              onStartScrape={handleStartSelectedScrape}
              onStartMaintenance={handleStartSelectedMaintenance}
            />
          ) : workbenchMode === "scrape" ? (
            <>
              <ScrapeWorkbenchAdapter
                ports={workbenchPorts}
                onPauseScrape={handlePauseScrape}
                onResumeScrape={handleResumeScrape}
                onStopScrape={handleStopScrape}
                onRetryFailed={handleRetryFailed}
                failedCount={failedPaths.length}
              />
              <ScrapeCompletionDialog />
            </>
          ) : (
            <MaintenanceWorkbenchAdapter ports={workbenchPorts} />
          )}
        </Suspense>
      </div>

      <ScrapeStartErrorDialog error={startError} onClose={() => setStartError(null)} />
    </div>
  );
}

function WorkbenchRoute() {
  const search = Route.useSearch();
  return <DesktopWorkbenchRoute routeIntent={search.intent} />;
}

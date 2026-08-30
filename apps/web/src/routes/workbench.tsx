import { toErrorMessage } from "@mdcz/shared/error";
import { SUPPORTED_MEDIA_EXTENSIONS } from "@mdcz/shared/mediaExtensions";
import type { MaintenancePresetId, MediaCandidate, ScrapeResult } from "@mdcz/shared/types";
import {
  activateNewScrapeTask,
  buildUncensoredConfirmationItems,
  MaintenanceWorkbenchAdapter,
  resetScrapeWorkbenchToSetup,
  ScrapeWorkbenchAdapter,
  type SharedWorkbenchPorts,
  startMaintenanceFlow,
  useWorkbenchSessionSnapshot,
  WorkbenchSetupAdapter,
  type WorkbenchSetupPort,
} from "@mdcz/views/adapters";
import { UncensoredConfirmDialog, type UncensoredConfirmSelection } from "@mdcz/views/scrape";
import {
  selectIsScraping,
  selectScrapeResults,
  selectScrapeStatus,
  selectScrapeTaskId,
  useScrapeStore,
} from "@mdcz/views/state/scrapeStore";
import { useUIStore } from "@mdcz/views/state/uiStore";
import { useWorkbenchTaskStore } from "@mdcz/views/state/workbenchTaskStore";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { createWebWorkbenchPorts } from "../adapters/ports";
import { api } from "../client";
import { requestPendingUncensoredConfirmationRefresh, requestScrapeLiveRunsRefresh } from "../hooks/useWebTaskSync";
import { queryKeys } from "../lib/queryKeys";
import { ErrorBanner } from "../routeCommon";

export const Route = createFileRoute("/workbench")({
  validateSearch: (search): { intent?: "maintenance" } => ({
    intent: search.intent === "maintenance" ? "maintenance" : undefined,
  }),
  component: WorkbenchPage,
});

const createWebSetupPort = (): WorkbenchSetupPort => ({
  browseDirectory: async (_kind, currentPath) => {
    return currentPath || null;
  },
  isServer: true,
  suggestDirectory: async ({ kind, path }) =>
    await api.serverPaths.suggest({
      path,
      intent: kind === "scan" ? "workbench-scan" : "workbench-output",
    }),
  scanCandidates: async (scanDir, excludeDirPaths) => {
    const result = await api.scans.candidates({
      scanDir,
      excludeDirPaths: excludeDirPaths ? [...excludeDirPaths] : undefined,
      supportedExtensions: [...SUPPORTED_MEDIA_EXTENSIONS],
    });
    return {
      candidates: result.candidates,
      supportedExtensions: [...SUPPORTED_MEDIA_EXTENSIONS],
    };
  },
});

const STOP_SCRAPE_CONFIRM_MESSAGE = "确定要停止刮削吗？";
const getRetryFailedConfirmMessage = (failedCount: number): string => `确定要批量重试 ${failedCount} 个失败项目吗？`;

type WebScrapeRetryTarget = Parameters<SharedWorkbenchPorts["scrape"]["retrySelection"]>[0][number];

const scrapeResultToWebRetryRef = (result: ScrapeResult): WebScrapeRetryTarget["ref"] =>
  result.rootId && result.relativePath ? { rootId: result.rootId, relativePath: result.relativePath } : undefined;

const scrapeResultsToWebRetryTargets = (results: ScrapeResult[]): WebScrapeRetryTarget[] =>
  results
    .filter((result) => result.status === "failed")
    .map((result) => ({
      filePath: result.output?.relativePath ?? result.relativePath,
      ref: scrapeResultToWebRetryRef(result),
    }));

function WorkbenchPage() {
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const ports = useMemo<SharedWorkbenchPorts>(() => createWebWorkbenchPorts(), []);
  const setupPort = useMemo(() => createWebSetupPort(), []);
  const [uncensoredDialogOpen, setUncensoredDialogOpen] = useState(false);
  const { hydrationState, clearUncensoredConfirmation, refreshError } = useWorkbenchTaskStore(
    useShallow((state) => ({
      hydrationState: state.hydrationState,
      clearUncensoredConfirmation: state.clearUncensoredConfirmation,
      refreshError: state.refreshError,
    })),
  );
  const activeScrapeTaskId = useScrapeStore(selectScrapeTaskId);
  const configQ = useQuery({ queryFn: () => api.config.read(), queryKey: queryKeys.config.current, retry: false });

  const { isScraping, scrapeStatus, results } = useScrapeStore(
    useShallow((state) => ({
      isScraping: selectIsScraping(state),
      scrapeStatus: selectScrapeStatus(state),
      results: selectScrapeResults(state),
    })),
  );
  const { workbenchMode, setWorkbenchMode } = useUIStore(
    useShallow((state) => ({
      workbenchMode: state.workbenchMode,
      setWorkbenchMode: state.setWorkbenchMode,
    })),
  );

  const sessionSnapshot = useWorkbenchSessionSnapshot(workbenchMode, search.intent);
  const showSetup = sessionSnapshot.showSetup;
  const failedTargets = useMemo(() => scrapeResultsToWebRetryTargets(results), [results]);

  useEffect(() => {
    if (sessionSnapshot.workbenchMode !== workbenchMode) {
      setWorkbenchMode(sessionSnapshot.workbenchMode);
    }
  }, [sessionSnapshot.workbenchMode, setWorkbenchMode, workbenchMode]);

  useEffect(() => {
    if (hydrationState.shouldOpenUncensoredDialog) {
      setUncensoredDialogOpen(true);
    }
  }, [hydrationState.shouldOpenUncensoredDialog]);

  const handleStartSelectedScrape = async (candidates: MediaCandidate[], targetDir: string) => {
    activateNewScrapeTask(candidates.map((candidate) => candidate.path));
    try {
      const outputRoot = targetDir.trim() ? await api.mediaRoots.ensurePath({ hostPath: targetDir }) : undefined;
      await api.scrape.start({ refs: candidates.map((candidate) => candidate.ref), outputRootId: outputRoot?.id });
      requestScrapeLiveRunsRefresh();
      toast.success("已启动选中文件刮削");
    } catch (error) {
      resetScrapeWorkbenchToSetup();
      toast.error(`启动失败: ${toErrorMessage(error)}`);
    }
  };

  const handleStartSelectedMaintenance = async (candidates: MediaCandidate[], presetId: MaintenancePresetId) => {
    await startMaintenanceFlow({
      candidates,
      presetId,
      port: ports.maintenance,
      isScraping,
      setWorkbenchMode,
      onRefreshConfig: async () => {
        await queryClient.invalidateQueries({ queryKey: queryKeys.config.all });
      },
      toast,
      toErrorMessage,
    });
  };

  const requireActiveScrapeTaskId = () => {
    if (!activeScrapeTaskId) {
      toast.info("当前没有可控制的刮削任务");
      return null;
    }
    return activeScrapeTaskId;
  };

  const handlePauseScrape = async () => {
    const taskId = requireActiveScrapeTaskId();
    if (!taskId) return;
    try {
      await api.scrape.pause({ taskId });
      requestScrapeLiveRunsRefresh();
      toast.info("任务已暂停");
    } catch (error) {
      toast.error(`暂停失败: ${toErrorMessage(error)}`);
    }
  };

  const handleResumeScrape = async () => {
    const taskId = requireActiveScrapeTaskId();
    if (!taskId) return;
    try {
      await api.scrape.resume({ taskId });
      requestScrapeLiveRunsRefresh();
      toast.success("任务已恢复");
    } catch (error) {
      toast.error(`恢复失败: ${toErrorMessage(error)}`);
    }
  };

  const handleStopScrape = async () => {
    const taskId = requireActiveScrapeTaskId();
    if (!taskId) return;
    if (!window.confirm(STOP_SCRAPE_CONFIRM_MESSAGE)) return;
    try {
      await api.scrape.stop({ taskId });
      requestScrapeLiveRunsRefresh();
      toast.info("正在停止...");
    } catch (error) {
      toast.error(`停止失败: ${toErrorMessage(error)}`);
    }
  };

  const handleRetryFailed = async () => {
    const targets = scrapeResultsToWebRetryTargets(selectScrapeResults(useScrapeStore.getState()));
    if (targets.length === 0) {
      toast.info("当前没有可重试的失败项目");
      return;
    }
    if (!window.confirm(getRetryFailedConfirmMessage(targets.length))) {
      return;
    }
    try {
      const result = await ports.scrape.retrySelection(targets, { scrapeStatus });
      toast.success(result.message);
    } catch (error) {
      toast.error(`重试失败: ${toErrorMessage(error)}`);
    }
  };

  const handleConfirmUncensored = async (selections: UncensoredConfirmSelection[]) => {
    if (!hydrationState.uncensoredTaskId) {
      throw new Error("缺少刮削任务 ID");
    }
    await api.scrape.confirmUncensored({
      taskId: hydrationState.uncensoredTaskId,
      items: buildUncensoredConfirmationItems(hydrationState.ambiguousUncensoredItems, selections),
    });
    clearUncensoredConfirmation();
    requestScrapeLiveRunsRefresh();
    requestPendingUncensoredConfirmationRefresh();
    toast.success("已提交无码确认重刮任务");
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {refreshError ? <ErrorBanner>{`任务状态刷新失败: ${refreshError}`}</ErrorBanner> : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        {showSetup ? (
          <WorkbenchSetupAdapter
            mode={workbenchMode}
            config={configQ.data}
            configLoading={configQ.isLoading}
            port={setupPort}
            onStartScrape={handleStartSelectedScrape}
            onStartMaintenance={handleStartSelectedMaintenance}
          />
        ) : workbenchMode === "scrape" ? (
          <ScrapeWorkbenchAdapter
            ports={ports}
            failedCount={failedTargets.length}
            onPauseScrape={() => void handlePauseScrape()}
            onResumeScrape={() => void handleResumeScrape()}
            onRetryFailed={() => void handleRetryFailed()}
            onStopScrape={() => void handleStopScrape()}
          />
        ) : (
          <MaintenanceWorkbenchAdapter ports={ports} />
        )}
      </div>
      <UncensoredConfirmDialog
        open={uncensoredDialogOpen && hydrationState.ambiguousUncensoredItems.length > 0}
        items={hydrationState.ambiguousUncensoredItems}
        onOpenChange={setUncensoredDialogOpen}
        onConfirm={handleConfirmUncensored}
      />
    </div>
  );
}

export const __workbenchTestHooks = {
  getRetryFailedConfirmMessage,
  scrapeResultsToWebRetryTargets,
  STOP_SCRAPE_CONFIRM_MESSAGE,
};

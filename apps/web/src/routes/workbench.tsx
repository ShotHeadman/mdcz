import type { DirectorySource } from "@mdcz/shared/directoryTasks";
import { toErrorMessage } from "@mdcz/shared/error";
import { SUPPORTED_MEDIA_EXTENSIONS } from "@mdcz/shared/mediaExtensions";
import type { MaintenancePresetId, MediaCandidate } from "@mdcz/shared/types";
import {
  activateNewScrapeTask,
  buildUncensoredConfirmationItems,
  MaintenanceWorkbenchAdapter,
  ScrapeWorkbenchAdapter,
  type SharedWorkbenchPorts,
  startMaintenanceFlow,
  useScrapeTerminalError,
  useWorkbenchSessionSnapshot,
  WorkbenchSetupAdapter,
  type WorkbenchSetupPort,
} from "@mdcz/views/adapters";
import { confirmDialog } from "@mdcz/views/common";
import { getT, useT } from "@mdcz/views/i18n";
import { ScrapeStartErrorDialog, UncensoredConfirmDialog, type UncensoredConfirmSelection } from "@mdcz/views/scrape";
import { changeMaintenancePreset, useMaintenanceStore } from "@mdcz/views/state/maintenanceStore";
import {
  runScrapeRequest,
  selectIsScraping,
  selectScrapeResults,
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
  cancelCandidates: async (scanId) => {
    await api.scans.cancelCandidates({ scanId });
  },
  scanCandidates: async (scanDir, recursive, excludeDirPaths, scanId) => {
    const result = await api.scans.candidates({
      scanId,
      scanDir,
      recursive,
      excludeDirPaths: excludeDirPaths ? [...excludeDirPaths] : undefined,
      supportedExtensions: [...SUPPORTED_MEDIA_EXTENSIONS],
    });
    return {
      candidates: result.candidates,
      warnings: result.warnings,
      supportedExtensions: [...SUPPORTED_MEDIA_EXTENSIONS],
    };
  },
});

function WorkbenchPage() {
  const t = useT();
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const ports = useMemo<SharedWorkbenchPorts>(() => createWebWorkbenchPorts(), []);
  const setupPort = useMemo(() => createWebSetupPort(), []);
  const [uncensoredDialogOpen, setUncensoredDialogOpen] = useState(false);
  const [startError, setStartError] = useState<unknown>(null);
  const { hydrationState, clearUncensoredConfirmation, refreshError } = useWorkbenchTaskStore(
    useShallow((state) => ({
      hydrationState: state.hydrationState,
      clearUncensoredConfirmation: state.clearUncensoredConfirmation,
      refreshError: state.refreshError,
    })),
  );
  const activeScrapeTaskId = useScrapeStore(selectScrapeTaskId);
  const configQ = useQuery({ queryFn: () => api.config.read(), queryKey: queryKeys.config.current, retry: false });

  const { isScraping, results } = useScrapeStore(
    useShallow((state) => ({
      isScraping: selectIsScraping(state),
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
  const failedCount = useMemo(
    () => results.filter((result) => result.status === "failed" || result.status === "skipped").length,
    [results],
  );

  useScrapeTerminalError(setStartError);

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

  const handleStartDirectory = async (source: DirectorySource, targetDir: string, presetId: MaintenancePresetId) => {
    try {
      if (workbenchMode === "maintenance") {
        if (isScraping) throw new Error(t.web.stopScrapeFirst);
        changeMaintenancePreset(presetId);
        useMaintenanceStore.getState().setPending(true);
        await api.maintenance.start({ source, targetDir, presetId });
        useMaintenanceStore.getState().setSnapshot(await api.maintenance.getActiveSession());
      } else {
        activateNewScrapeTask();
        await runScrapeRequest(async () => {
          await api.scrape.start({ executionMode: "batch", source, targetDir });
          requestScrapeLiveRunsRefresh();
        });
      }
      toast.success(t.web.taskSubmitted);
    } catch (error) {
      if (workbenchMode === "maintenance") useMaintenanceStore.getState().setPending(false);
      throw error;
    }
  };

  const handleStartSelectedScrape = async (candidates: MediaCandidate[], targetDir: string) => {
    try {
      activateNewScrapeTask();
      await runScrapeRequest(async () => {
        const outputRoot = await api.mediaRoots.prepareOutputDirectory({ hostPath: targetDir });
        await api.scrape.start({
          refs: candidates.map((candidate) => candidate.ref),
          executionMode: "batch",
          outputRootId: outputRoot.id,
          outputRelativeDirectory: outputRoot.relativeDirectory,
        });
        requestScrapeLiveRunsRefresh();
      });
      toast.success(t.web.selectedScrapeStarted);
    } catch (error) {
      useScrapeStore.getState().setError(toErrorMessage(error));
      setStartError(error);
    }
  };

  const handleStartSelectedMaintenance = async (
    candidates: MediaCandidate[],
    presetId: MaintenancePresetId,
    targetDir?: string,
  ) => {
    await startMaintenanceFlow({
      candidates,
      presetId,
      targetDir,
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
      toast.info(t.web.noControllableScrapeTask);
      return null;
    }
    return activeScrapeTaskId;
  };

  const handlePauseScrape = async () => {
    const taskId = requireActiveScrapeTaskId();
    if (!taskId) return;
    try {
      await runScrapeRequest(async () => {
        await api.scrape.pause({ taskId });
        requestScrapeLiveRunsRefresh();
      });
      toast.info(t.web.taskPaused);
    } catch (error) {
      toast.error(t.web.pauseFailed(toErrorMessage(error)));
    }
  };

  const handleResumeScrape = async () => {
    const taskId = requireActiveScrapeTaskId();
    if (!taskId) return;
    try {
      await runScrapeRequest(async () => {
        await api.scrape.resume({ taskId });
        requestScrapeLiveRunsRefresh();
      });
      toast.success(t.web.taskResumed);
    } catch (error) {
      toast.error(t.web.resumeFailed(toErrorMessage(error)));
    }
  };

  const handleStopScrape = async () => {
    const taskId = requireActiveScrapeTaskId();
    if (!taskId) return;
    if (!(await confirmDialog({ title: t.web.stopScrapeConfirm, destructive: true }))) return;
    try {
      await runScrapeRequest(async () => {
        await api.scrape.stop({ taskId });
        requestScrapeLiveRunsRefresh();
      });
      toast.info(t.web.stopping);
    } catch (error) {
      toast.error(t.web.stopFailed(toErrorMessage(error)));
    }
  };

  const handleRetryFailed = async () => {
    if (failedCount === 0) {
      toast.info(t.web.noFailedItemsToRetry);
      return;
    }
    if (
      !(await confirmDialog({
        title: t.web.retryFailedConfirm(failedCount),
        confirmLabel: t.workbench.retryFailed,
      }))
    ) {
      return;
    }
    try {
      await ports.scrape.retryFailed();
      toast.success(getT().scrape.launch.retry);
    } catch (error) {
      setStartError(error);
    }
  };

  const handleConfirmUncensored = async (selections: UncensoredConfirmSelection[]) => {
    await api.scrape.confirmUncensored({
      items: buildUncensoredConfirmationItems(hydrationState.ambiguousUncensoredItems, selections),
    });
    clearUncensoredConfirmation();
    requestScrapeLiveRunsRefresh();
    requestPendingUncensoredConfirmationRefresh();
    toast.success(t.web.updatedUncensoredTypes);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {refreshError ? <ErrorBanner>{t.web.taskRefreshFailed(refreshError)}</ErrorBanner> : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        {showSetup ? (
          <WorkbenchSetupAdapter
            mode={workbenchMode}
            config={configQ.data}
            configLoading={configQ.isLoading}
            port={setupPort}
            onStartDirectory={handleStartDirectory}
            onStartScrape={handleStartSelectedScrape}
            onStartMaintenance={handleStartSelectedMaintenance}
          />
        ) : workbenchMode === "scrape" ? (
          <ScrapeWorkbenchAdapter
            ports={ports}
            siteUrls={configQ.data?.network}
            failedCount={failedCount}
            onPauseScrape={() => void handlePauseScrape()}
            onResumeScrape={() => void handleResumeScrape()}
            onRetryFailed={() => void handleRetryFailed()}
            onStopScrape={() => void handleStopScrape()}
          />
        ) : (
          <MaintenanceWorkbenchAdapter ports={ports} />
        )}
      </div>
      <ScrapeStartErrorDialog error={startError} onClose={() => setStartError(null)} />
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
  getRetryFailedConfirmMessage: (failedCount: number): string => getT().web.retryFailedConfirm(failedCount),
  get STOP_SCRAPE_CONFIRM_MESSAGE() {
    return getT().web.stopScrapeConfirm;
  },
};

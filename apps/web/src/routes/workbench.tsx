import type { DirectorySource } from "@mdcz/shared/directoryTasks";
import { toErrorMessage } from "@mdcz/shared/error";
import { SUPPORTED_MEDIA_EXTENSIONS } from "@mdcz/shared/mediaExtensions";
import type { MaintenancePresetId, MediaCandidate } from "@mdcz/shared/types";
import {
  activateNewScrapeTask,
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
import { useT } from "@mdcz/views/i18n";
import { ScrapeStartErrorDialog } from "@mdcz/views/scrape";
import { changeMaintenancePreset, useMaintenanceStore } from "@mdcz/views/state/maintenanceStore";
import {
  runScrapeRequest,
  selectScrapeResults,
  selectScrapeTaskId,
  useScrapeStore,
} from "@mdcz/views/state/scrapeStore";
import { useUIStore } from "@mdcz/views/state/uiStore";
import { useWorkbenchTaskStore } from "@mdcz/views/state/workbenchTaskStore";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { createWebWorkbenchPorts } from "../adapters/ports";
import { api } from "../client";
import { browseDirectory } from "../desktop";
import { requestScrapeLiveRunsRefresh } from "../hooks/useWebTaskSync";
import { queryKeys } from "../lib/queryKeys";
import { ErrorBanner } from "../routeCommon";

export const Route = createFileRoute("/workbench")({
  validateSearch: (search): { intent?: "maintenance" } => ({
    intent: search.intent === "maintenance" ? "maintenance" : undefined,
  }),
  component: WorkbenchPage,
});

const createWebSetupPort = (): WorkbenchSetupPort => ({
  browseDirectory,
  suggestDirectory: async (path) => await api.serverPaths.suggest({ path, intent: "workbench-scan" }),
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
  const navigate = useNavigate();
  const ports = useMemo<SharedWorkbenchPorts>(() => createWebWorkbenchPorts(), []);
  const setupPort = useMemo(() => createWebSetupPort(), []);
  const [startError, setStartError] = useState<unknown>(null);
  const refreshError = useWorkbenchTaskStore((state) => state.refreshError);
  const activeScrapeTaskId = useScrapeStore(selectScrapeTaskId);
  const configQ = useQuery({ queryFn: () => api.config.read(), queryKey: queryKeys.config.current });
  const librariesQ = useQuery({ queryFn: () => api.libraries.list(), queryKey: queryKeys.libraries.all });

  const results = useScrapeStore(selectScrapeResults);
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

  const handleStartDirectory = async (
    source: DirectorySource,
    libraryId: string | undefined,
    presetId: MaintenancePresetId,
  ) => {
    try {
      if (workbenchMode === "maintenance") {
        changeMaintenancePreset(presetId);
        useMaintenanceStore.getState().setPending(true);
        await api.maintenance.start({ source, libraryId, presetId });
        useMaintenanceStore.getState().setSnapshot(await api.maintenance.getActiveSession());
      } else {
        if (!libraryId) throw new Error(t.workbench.noLibraries);
        activateNewScrapeTask();
        await runScrapeRequest(async () => {
          await api.scrape.start({ executionMode: "batch", libraryId, source });
          requestScrapeLiveRunsRefresh();
        });
      }
    } catch (error) {
      if (workbenchMode === "maintenance") useMaintenanceStore.getState().setPending(false);
      throw error;
    }
  };

  const handleStartSelectedScrape = async (candidates: MediaCandidate[], libraryId: string) => {
    try {
      activateNewScrapeTask();
      await runScrapeRequest(async () => {
        await api.scrape.start({
          refs: candidates.map((candidate) => candidate.ref),
          executionMode: "batch",
          libraryId,
        });
        requestScrapeLiveRunsRefresh();
      });
    } catch (error) {
      useScrapeStore.getState().setError(toErrorMessage(error));
      setStartError(error);
    }
  };

  const handleStartSelectedMaintenance = async (
    candidates: MediaCandidate[],
    presetId: MaintenancePresetId,
    libraryId?: string,
  ) => {
    await startMaintenanceFlow({
      refs: candidates.map((candidate) => candidate.ref),
      presetId,
      libraryId,
      port: ports.maintenance,
      setWorkbenchMode,
      onRefreshConfig: async () => {
        await queryClient.invalidateQueries({ queryKey: queryKeys.config.all });
      },
    });
  };

  const handlePauseScrape = async () => {
    const taskId = activeScrapeTaskId;
    if (!taskId) return;
    try {
      await runScrapeRequest(async () => {
        await api.scrape.pause({ taskId });
        requestScrapeLiveRunsRefresh();
      });
    } catch (error) {
      toast.error(t.web.pauseFailed(toErrorMessage(error)), { id: "scrape-control" });
    }
  };

  const handleResumeScrape = async () => {
    const taskId = activeScrapeTaskId;
    if (!taskId) return;
    try {
      await runScrapeRequest(async () => {
        await api.scrape.resume({ taskId });
        requestScrapeLiveRunsRefresh();
      });
    } catch (error) {
      toast.error(t.web.resumeFailed(toErrorMessage(error)), { id: "scrape-control" });
    }
  };

  const handleStopScrape = async () => {
    const taskId = activeScrapeTaskId;
    if (!taskId) return;
    if (!(await confirmDialog({ title: t.web.stopScrapeConfirm, destructive: true }))) return;
    try {
      await runScrapeRequest(async () => {
        await api.scrape.stop({ taskId });
        requestScrapeLiveRunsRefresh();
      });
    } catch (error) {
      toast.error(t.web.stopFailed(toErrorMessage(error)), { id: "scrape-control" });
    }
  };

  const handleRetryFailed = async () => {
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
    } catch (error) {
      setStartError(error);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {refreshError ? <ErrorBanner>{t.web.taskRefreshFailed(refreshError)}</ErrorBanner> : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        {showSetup ? (
          <WorkbenchSetupAdapter
            mode={workbenchMode}
            config={configQ.data}
            configLoading={configQ.isLoading || librariesQ.isLoading}
            libraries={librariesQ.data?.libraries}
            onManageLibraries={() => void navigate({ to: "/libraries" })}
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
    </div>
  );
}

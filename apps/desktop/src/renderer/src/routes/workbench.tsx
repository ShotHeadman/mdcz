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
import { confirmDialog } from "@mdcz/views/common";
import { useT } from "@mdcz/views/i18n";
import { ScrapeStartErrorDialog } from "@mdcz/views/scrape";
import {
  changeMaintenancePreset,
  selectMaintenanceExecutionStatus,
  useMaintenanceStore,
} from "@mdcz/views/state/maintenanceStore";
import { runScrapeRequest, selectIsScraping, selectScrapeResults, useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { useUIStore } from "@mdcz/views/state/uiStore";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { createDesktopWorkbenchPorts } from "@/adapters/ports";
import { pauseScrape, resumeScrape, retryScrapeSelection, startSelectedScrape, stopScrape } from "@/api/manual";
import { ipc } from "@/client/ipc";
import { isMediaDirectorySelectionCancelled } from "@/client/mediaPath";
import WorkbenchSetup from "@/components/workbench/WorkbenchSetup";
import { CURRENT_CONFIG_QUERY_KEY, useCurrentConfig } from "@/hooks/configQueries";

export const Route = createFileRoute("/workbench")({
  validateSearch: (search): { intent?: "maintenance" } => ({
    intent: search.intent === "maintenance" ? "maintenance" : undefined,
  }),
  component: WorkbenchRoute,
});

export function DesktopWorkbenchRoute({ routeIntent }: { routeIntent?: "maintenance" }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [startError, setStartError] = useState<unknown>(null);
  const navigate = useNavigate();
  const configQ = useCurrentConfig();
  const librariesQ = useQuery({ queryKey: ["libraries"], queryFn: () => ipc.libraries.list() });
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

  const handleStartDirectory = async (
    source: DirectorySource,
    libraryId: string | undefined,
    presetId: MaintenancePresetId,
  ) => {
    try {
      if (workbenchMode === "maintenance") {
        if (isScraping) throw new Error(t.desktop.stopScrapeFirst);
        changeMaintenancePreset(presetId);
        useMaintenanceStore.getState().setPending(true);
        await ipc.maintenance.directory(source, presetId, libraryId);
      } else {
        if (maintenanceBusy) throw new Error(t.desktop.stopMaintenanceFirst);
        if (!libraryId) throw new Error(t.workbench.noLibraries);
        activateNewScrapeTask();
        await ipc.scraper.start({ executionMode: "batch", libraryId, source });
      }
      toast.success(t.desktop.taskSubmitted);
    } catch (error) {
      if (workbenchMode === "maintenance") useMaintenanceStore.getState().setPending(false);
      throw error;
    }
  };

  const handleStartSelectedScrape = async (candidates: MediaCandidate[], libraryId: string) => {
    if (maintenanceBusy) {
      toast.warning(t.desktop.maintenanceRunningWarning);
      return;
    }

    try {
      activateNewScrapeTask();
      await startSelectedScrape(
        candidates.map((candidate) => candidate.ref),
        libraryId,
      );
      toast.success(t.scrape.launch.selection);
    } catch (error) {
      const errorMessage = toErrorMessage(error);

      if (isMediaDirectorySelectionCancelled(error)) {
        return;
      }

      if (errorMessage.includes("NO_FILES")) {
        toast.info(t.desktop.noMediaToScrape);
        return;
      }

      setStartError(error);
    }
  };

  const handleStartSelectedMaintenance = async (
    candidates: MediaCandidate[],
    presetId: MaintenancePresetId,
    libraryId?: string,
  ) => {
    if (isScraping) {
      toast.warning(t.desktop.scrapeRunningWarning);
      return;
    }

    await startMaintenanceFlow({
      candidates,
      presetId,
      libraryId,
      port: workbenchPorts.maintenance,
      isScraping,
      setWorkbenchMode,
      onRefreshConfig: refreshCurrentConfig,
      toast,
      toErrorMessage,
    });
  };

  const handleStopScrape = async () => {
    if (!(await confirmDialog({ title: t.desktop.confirmStopScrape, destructive: true }))) return;
    try {
      await runScrapeRequest(stopScrape);
      toast.info(t.desktop.stopping);
    } catch (_error) {
      toast.error(t.desktop.stopScrapeFailed);
    }
  };

  const handlePauseScrape = async () => {
    try {
      await runScrapeRequest(pauseScrape);
      toast.info(t.desktop.taskPaused);
    } catch (_error) {
      toast.error(t.desktop.pauseFailed);
    }
  };

  const handleResumeScrape = async () => {
    try {
      await runScrapeRequest(resumeScrape);
      toast.success(t.desktop.taskResumed);
    } catch (_error) {
      toast.error(t.desktop.resumeFailed);
    }
  };

  const handleRetryFailed = async () => {
    if (failedPaths.length === 0) {
      toast.info(t.desktop.noFailedItemsToRetry);
      return;
    }

    if (
      !(await confirmDialog({
        title: t.desktop.confirmBatchRetry(failedPaths.length),
        confirmLabel: t.workbench.retryFailed,
      }))
    ) {
      return;
    }

    try {
      await retryScrapeSelection();
      toast.success(t.scrape.launch.retry);
    } catch (error) {
      setStartError(error);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t.common.loading}
            </div>
          }
        >
          {showSetup ? (
            <WorkbenchSetup
              mode={workbenchMode}
              config={configQ.data}
              configLoading={configQ.isLoading || librariesQ.isLoading}
              libraries={librariesQ.data?.libraries}
              onManageLibraries={() => void navigate({ to: "/libraries" })}
              onStartDirectory={handleStartDirectory}
              onStartScrape={handleStartSelectedScrape}
              onStartMaintenance={handleStartSelectedMaintenance}
            />
          ) : workbenchMode === "scrape" ? (
            <ScrapeWorkbenchAdapter
              ports={workbenchPorts}
              siteUrls={configQ.data?.network}
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

      <ScrapeStartErrorDialog error={startError} onClose={() => setStartError(null)} />
    </div>
  );
}

function WorkbenchRoute() {
  const search = Route.useSearch();
  return <DesktopWorkbenchRoute routeIntent={search.intent} />;
}

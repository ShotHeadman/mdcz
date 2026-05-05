import {
  activateNewScrapeTask,
  applyScrapeTaskStatus,
  buildUncensoredConfirmationItems,
  getFailedScrapeTargets,
  MaintenanceWorkbenchAdapter,
  ScrapeWorkbenchAdapter,
  type SharedWorkbenchPorts,
  startMaintenanceFlow,
  useWorkbenchSessionSnapshot,
  WorkbenchSetupAdapter,
  type WorkbenchSetupPort,
} from "@mdcz/shared/adapters";
import { scrapeResultDtoToScrapeResult } from "@mdcz/shared/dtoAdapters";
import { toErrorMessage } from "@mdcz/shared/error";
import { SUPPORTED_MEDIA_EXTENSIONS } from "@mdcz/shared/mediaExtensions";
import type { ScrapeResultDto } from "@mdcz/shared/serverDtos";
import { useScrapeStore } from "@mdcz/shared/stores/scrapeStore";
import { useUIStore } from "@mdcz/shared/stores/uiStore";
import {
  applyWebTaskUpdate,
  createTaskHydrationState,
  hydrateScrapeResults,
  type TaskHydrationState,
} from "@mdcz/shared/taskHydration";
import type { MaintenancePresetId, ScrapeResult } from "@mdcz/shared/types";
import { UncensoredConfirmDialog, type UncensoredConfirmSelection } from "@mdcz/views/scrape";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { createWebWorkbenchPorts } from "../adapters/ports";
import { api, subscribeTaskUpdates } from "../client";

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
  supportsPathBrowse: false,
  suggestDirectory: async ({ kind, path }) =>
    await api.serverPaths.suggest({
      path,
      intent: kind === "scan" ? "workbench-scan" : "workbench-output",
    }),
  scanCandidates: async (scanDir, excludeDirPath) => {
    const result = await api.scans.candidates({
      scanDir,
      excludeDirs: excludeDirPath ? [excludeDirPath] : [],
      supportedExtensions: [...SUPPORTED_MEDIA_EXTENSIONS],
    });
    return {
      candidates: result.candidates,
      supportedExtensions: [...SUPPORTED_MEDIA_EXTENSIONS],
    };
  },
  savePaths: async (scanDir, targetDir) => {
    await api.config.save({
      paths: {
        mediaPath: scanDir,
        successOutputFolder: targetDir,
      },
    });
  },
});

const scrapeResultsToRetryTargets = (results: ScrapeResult[]) =>
  results
    .filter((result) => result.status === "failed")
    .map((result) => {
      const [rootId, ...relativeParts] = result.fileId.split(":");
      const relativePath = relativeParts.join(":");
      return {
        filePath: result.fileInfo.filePath,
        ref: rootId && relativePath ? { rootId, relativePath } : undefined,
      };
    });

function WorkbenchPage() {
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const ports = useMemo<SharedWorkbenchPorts>(() => createWebWorkbenchPorts(), []);
  const setupPort = useMemo(() => createWebSetupPort(), []);
  const [uncensoredDialogOpen, setUncensoredDialogOpen] = useState(false);
  const [hydrationState, setHydrationState] = useState<TaskHydrationState>(createTaskHydrationState);
  const hydrationStateRef = useRef(hydrationState);
  const configQ = useQuery({ queryFn: () => api.config.read(), queryKey: ["config"], retry: false });
  const scrapeResultsQ = useQuery({
    queryFn: () => api.scrape.listResults(),
    queryKey: ["scrapeResults"],
    retry: false,
  });

  const { isScraping, scrapeStatus, results } = useScrapeStore(
    useShallow((state) => ({
      isScraping: state.isScraping,
      scrapeStatus: state.scrapeStatus,
      results: state.results,
    })),
  );
  const { workbenchMode, setWorkbenchMode } = useUIStore(
    useShallow((state) => ({
      workbenchMode: state.workbenchMode,
      setWorkbenchMode: state.setWorkbenchMode,
    })),
  );

  const sessionSnapshot = useWorkbenchSessionSnapshot(workbenchMode, search.intent);
  const failedTargets = useMemo(() => scrapeResultsToRetryTargets(results), [results]);

  useEffect(() => {
    if (sessionSnapshot.workbenchMode !== workbenchMode) {
      setWorkbenchMode(sessionSnapshot.workbenchMode);
    }
  }, [sessionSnapshot.workbenchMode, setWorkbenchMode, workbenchMode]);

  useEffect(() => {
    if (scrapeResultsQ.data) {
      hydrateScrapeResults(scrapeResultsQ.data);
    }
  }, [scrapeResultsQ.data]);

  useEffect(() => {
    hydrationStateRef.current = hydrationState;
  }, [hydrationState]);

  useEffect(
    () =>
      subscribeTaskUpdates((payload) => {
        const nextState = applyWebTaskUpdate(payload, hydrationStateRef.current);
        hydrationStateRef.current = nextState;
        setHydrationState(nextState);
        if (nextState.shouldOpenUncensoredDialog) {
          setUncensoredDialogOpen(true);
        }
        void queryClient.invalidateQueries({ queryKey: ["scrapeResults"] });
        void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      }),
    [queryClient],
  );

  const handleStartSelectedScrape = async (filePaths: string[], scanDir: string, targetDir: string) => {
    try {
      activateNewScrapeTask();
      const task = await api.scrape.startSelectedFiles({ filePaths, scanDir, targetDir });
      setHydrationState((state) => ({ ...state, activeScrapeTaskId: task.id }));
      applyScrapeTaskStatus(task.status);
      toast.success("刮削任务已提交");
    } catch (error) {
      toast.error(`启动失败: ${toErrorMessage(error)}`);
    }
  };

  const handleStartSelectedMaintenance = async (
    filePaths: string[],
    scanDir: string,
    _targetDir: string,
    presetId: MaintenancePresetId,
  ) => {
    await startMaintenanceFlow({
      filePaths,
      scanDir,
      presetId,
      port: ports.maintenance,
      isScraping,
      setWorkbenchMode,
      onRefreshConfig: async () => {
        await queryClient.invalidateQueries({ queryKey: ["config"] });
      },
      toast,
      toErrorMessage,
    });
  };

  const requireActiveScrapeTaskId = () => {
    if (!hydrationState.activeScrapeTaskId) {
      toast.info("当前没有可控制的刮削任务");
      return null;
    }
    return hydrationState.activeScrapeTaskId;
  };

  const handlePauseScrape = async () => {
    const taskId = requireActiveScrapeTaskId();
    if (!taskId) return;
    try {
      const task = await api.scrape.pause({ taskId });
      applyScrapeTaskStatus(task.status);
      toast.info("任务已暂停");
    } catch (error) {
      toast.error(`暂停失败: ${toErrorMessage(error)}`);
    }
  };

  const handleResumeScrape = async () => {
    const taskId = requireActiveScrapeTaskId();
    if (!taskId) return;
    try {
      const task = await api.scrape.resume({ taskId });
      applyScrapeTaskStatus(task.status);
      toast.success("任务已恢复");
    } catch (error) {
      toast.error(`恢复失败: ${toErrorMessage(error)}`);
    }
  };

  const handleStopScrape = async () => {
    const taskId = requireActiveScrapeTaskId();
    if (!taskId) return;
    try {
      const task = await api.scrape.stop({ taskId });
      applyScrapeTaskStatus(task.status);
      toast.info("正在停止...");
    } catch (error) {
      toast.error(`停止失败: ${toErrorMessage(error)}`);
    }
  };

  const handleRetryFailed = async () => {
    const targets = getFailedScrapeTargets();
    if (targets.length === 0) {
      toast.info("当前没有可重试的失败项目");
      return;
    }
    try {
      const result = await ports.scrape.retrySelection(targets, { scrapeStatus });
      if (result.strategy === "new-task") {
        applyScrapeTaskStatus("running");
      }
      toast.success(result.message);
    } catch (error) {
      toast.error(`重试失败: ${toErrorMessage(error)}`);
    }
  };

  const handleConfirmUncensored = async (selections: UncensoredConfirmSelection[]) => {
    if (!hydrationState.uncensoredTaskId) {
      throw new Error("缺少刮削任务 ID");
    }
    const task = await api.scrape.confirmUncensored({
      taskId: hydrationState.uncensoredTaskId,
      items: buildUncensoredConfirmationItems(hydrationState.ambiguousUncensoredItems, selections),
    });
    setHydrationState((state) => ({
      ...state,
      ambiguousUncensoredItems: [],
      uncensoredTaskId: "",
      activeScrapeTaskId: task.id,
    }));
    applyScrapeTaskStatus(task.status);
    toast.success("已提交无码确认重刮任务");
  };

  return (
    <div className="h-full min-h-0 overflow-hidden">
      {sessionSnapshot.showSetup ? (
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
  dtoToScrapeResult: (result: ScrapeResultDto) => scrapeResultDtoToScrapeResult(result),
  scrapeResultsToRetryTargets,
};

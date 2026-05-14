import { scrapeResultDtoToScrapeResult } from "@mdcz/shared/dtoAdapters";
import { toErrorMessage } from "@mdcz/shared/error";
import { SUPPORTED_MEDIA_EXTENSIONS } from "@mdcz/shared/mediaExtensions";
import type { ScrapeResultDto } from "@mdcz/shared/serverDtos";
import { useScrapeStore } from "@mdcz/shared/stores/scrapeStore";
import { useUIStore } from "@mdcz/shared/stores/uiStore";
import { useWorkbenchTaskStore } from "@mdcz/shared/stores/workbenchTaskStore";
import type { MaintenancePresetId, ScrapeResult } from "@mdcz/shared/types";
import {
  activateNewScrapeTask,
  applyScrapeTaskStatus,
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { createWebWorkbenchPorts } from "../adapters/ports";
import { api } from "../client";

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
  scanCandidates: async (scanDir) => {
    const result = await api.scans.candidates({
      scanDir,
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

const STOP_SCRAPE_CONFIRM_MESSAGE = "确定要停止刮削吗？";
const getRetryFailedConfirmMessage = (failedCount: number): string => `确定要批量重试 ${failedCount} 个失败项目吗？`;

type WebScrapeRetryTarget = Parameters<SharedWorkbenchPorts["scrape"]["retrySelection"]>[0][number];

const scrapeResultToWebRetryRef = (result: ScrapeResult): WebScrapeRetryTarget["ref"] => {
  const [rootId, ...relativeParts] = result.fileId.split(":");
  const relativePath = relativeParts.join(":");

  return rootId && relativePath ? { rootId, relativePath } : undefined;
};

const scrapeResultsToWebRetryTargets = (results: ScrapeResult[]): WebScrapeRetryTarget[] =>
  results
    .filter((result) => result.status === "failed")
    .map((result) => ({
      filePath: result.fileInfo.filePath,
      ref: scrapeResultToWebRetryRef(result),
    }));

function WorkbenchPage() {
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const ports = useMemo<SharedWorkbenchPorts>(() => createWebWorkbenchPorts(), []);
  const setupPort = useMemo(() => createWebSetupPort(), []);
  const [uncensoredDialogOpen, setUncensoredDialogOpen] = useState(false);
  const { hydrationState, resolveUncensoredTask, setActiveScrapeTaskId, setScrapeStartPending } = useWorkbenchTaskStore(
    useShallow((state) => ({
      hydrationState: state.hydrationState,
      resolveUncensoredTask: state.resolveUncensoredTask,
      setActiveScrapeTaskId: state.setActiveScrapeTaskId,
      setScrapeStartPending: state.setScrapeStartPending,
    })),
  );
  const activeScrapeTaskId = hydrationState.activeScrapeTaskId;
  const configQ = useQuery({ queryFn: () => api.config.read(), queryKey: ["config"], retry: false });

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

  const handleStartSelectedScrape = async (filePaths: string[], scanDir: string, targetDir: string) => {
    setScrapeStartPending(true);
    try {
      activateNewScrapeTask();
      const task = await api.scrape.startSelectedFiles({ filePaths, scanDir, targetDir });
      setActiveScrapeTaskId(task.id);
      applyScrapeTaskStatus(task.status);
      toast.success("已启动选中文件刮削");
    } catch (error) {
      resetScrapeWorkbenchToSetup();
      toast.error(`启动失败: ${toErrorMessage(error)}`);
    } finally {
      setScrapeStartPending(false);
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
    if (!window.confirm(STOP_SCRAPE_CONFIRM_MESSAGE)) return;
    try {
      const task = await api.scrape.stop({ taskId });
      applyScrapeTaskStatus(task.status);
      toast.info("正在停止...");
    } catch (error) {
      toast.error(`停止失败: ${toErrorMessage(error)}`);
    }
  };

  const handleRetryFailed = async () => {
    const targets = scrapeResultsToWebRetryTargets(useScrapeStore.getState().results);
    if (targets.length === 0) {
      toast.info("当前没有可重试的失败项目");
      return;
    }
    if (!window.confirm(getRetryFailedConfirmMessage(targets.length))) {
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
    resolveUncensoredTask(task.id);
    applyScrapeTaskStatus(task.status);
    toast.success("已提交无码确认重刮任务");
  };

  return (
    <div className="h-full min-h-0 overflow-hidden">
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
  getRetryFailedConfirmMessage,
  scrapeResultsToWebRetryTargets,
  STOP_SCRAPE_CONFIRM_MESSAGE,
};

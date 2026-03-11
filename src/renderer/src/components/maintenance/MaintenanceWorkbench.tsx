import { useMemo } from "react";
import { toast } from "sonner";
import { ipc } from "@/client/ipc";
import MaintenanceBatchBar from "@/components/maintenance/MaintenanceBatchBar";
import MaintenanceDetailView from "@/components/maintenance/MaintenanceDetailView";
import MaintenanceEntryList from "@/components/maintenance/MaintenanceEntryList";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/Resizable";
import { buildMaintenanceCommitItem } from "@/lib/maintenance";
import { useMaintenanceStore } from "@/store/maintenanceStore";
import { useScrapeStore } from "@/store/scrapeStore";

const asMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
};

interface MaintenanceWorkbenchProps {
  mediaPath?: string;
}

export default function MaintenanceWorkbench({ mediaPath }: MaintenanceWorkbenchProps) {
  const isScraping = useScrapeStore((state) => state.isScraping);
  const {
    entries,
    presetId,
    selectedIds,
    executionStatus,
    currentPath,
    statusText,
    lastScannedDir,
    previewResults,
    fieldSelections,
    setEntries,
    setExecutionStatus,
    setCurrentPath,
    setStatusText,
    setPreviewPending,
    applyPreviewResult,
    clearPreviewResults,
    beginExecution,
  } = useMaintenanceStore((state) => ({
    entries: state.entries,
    presetId: state.presetId,
    selectedIds: state.selectedIds,
    executionStatus: state.executionStatus,
    currentPath: state.currentPath,
    statusText: state.statusText,
    lastScannedDir: state.lastScannedDir,
    previewResults: state.previewResults,
    fieldSelections: state.fieldSelections,
    setEntries: state.setEntries,
    setExecutionStatus: state.setExecutionStatus,
    setCurrentPath: state.setCurrentPath,
    setStatusText: state.setStatusText,
    setPreviewPending: state.setPreviewPending,
    applyPreviewResult: state.applyPreviewResult,
    clearPreviewResults: state.clearPreviewResults,
    beginExecution: state.beginExecution,
  }));

  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedIds.includes(entry.id)),
    [entries, selectedIds],
  );

  const ensureMaintenanceUnlocked = (): boolean => {
    if (!isScraping) {
      return true;
    }

    toast.warning("正常刮削正在进行中，无法启动维护模式。请先停止当前任务。");
    return false;
  };

  const resolveScanDirectory = async (): Promise<string | null> => {
    const preferred = lastScannedDir || mediaPath?.trim() || "";
    if (preferred) {
      return preferred;
    }

    const selection = await ipc.file.browse("directory");
    const path = selection.paths?.[0]?.trim();
    return path || null;
  };

  const handleScan = async () => {
    if (!ensureMaintenanceUnlocked()) {
      return;
    }

    const dirPath = await resolveScanDirectory();
    if (!dirPath) {
      toast.info("未选择维护目录");
      return;
    }

    setExecutionStatus("scanning");
    setCurrentPath(dirPath);
    setStatusText("正在扫描目录...");

    try {
      const result = await ipc.maintenance.scan(dirPath);
      setEntries(result.entries, dirPath);
      toast.success(`扫描完成，共发现 ${result.entries.length} 个项目`);
    } catch (error) {
      setExecutionStatus("idle");
      setCurrentPath(dirPath);
      setStatusText("扫描失败");
      toast.error(`扫描失败: ${asMessage(error)}`);
    }
  };

  const handlePreview = async () => {
    if (!ensureMaintenanceUnlocked()) {
      return false;
    }

    if (selectedEntries.length === 0) {
      toast.info("请先选择要执行的项目");
      return false;
    }

    clearPreviewResults();
    setPreviewPending(true);
    setStatusText(`正在预览 ${selectedEntries.length} 项...`);

    try {
      const preview = await ipc.maintenance.preview(selectedEntries, presetId);
      applyPreviewResult(preview);
      setStatusText(
        preview.blockedCount > 0
          ? `预览完成 · 可执行 ${preview.readyCount} · 阻塞 ${preview.blockedCount}`
          : `预览完成 · 可执行 ${preview.readyCount} 项`,
      );
      return true;
    } catch (error) {
      setPreviewPending(false);
      setStatusText("预览失败");
      clearPreviewResults();
      toast.error(`预览失败: ${asMessage(error)}`);
      return false;
    }
  };

  const handleExecute = async () => {
    if (!ensureMaintenanceUnlocked()) {
      return;
    }

    const executableEntries = selectedEntries.filter((entry) => previewResults[entry.id]?.status === "ready");
    const commitItems = executableEntries.map((entry) =>
      buildMaintenanceCommitItem(entry, previewResults[entry.id], fieldSelections[entry.id]),
    );

    if (commitItems.length === 0) {
      toast.info("没有可执行的项目，请先完成预览并处理阻塞项。");
      return;
    }

    beginExecution(commitItems.map((item) => item.entry.id));
    setCurrentPath(commitItems[0]?.entry.videoPath ?? currentPath);
    setStatusText(`正在执行 ${commitItems.length} 项...`);

    try {
      await ipc.maintenance.execute(commitItems, presetId);
      toast.success(`维护任务已启动，共 ${commitItems.length} 项`);
    } catch (error) {
      setExecutionStatus("idle");
      setStatusText("启动失败");
      toast.error(`启动失败: ${asMessage(error)}`);
    }
  };

  const handleStop = async () => {
    try {
      await ipc.maintenance.stop();
      setExecutionStatus("stopping");
      setStatusText("正在停止维护操作...");
      toast.info("正在停止维护操作...");
    } catch (error) {
      toast.error(`停止失败: ${asMessage(error)}`);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="px-4 pt-4">
        <MaintenanceBatchBar
          disabledByScrape={isScraping}
          onScan={handleScan}
          onPreview={handlePreview}
          onExecute={handleExecute}
          onStop={handleStop}
        />
      </div>

      <div className="flex-1 min-h-0 flex p-4">
        <ResizablePanelGroup orientation="horizontal" className="flex-1">
          <ResizablePanel
            id="maintenance-entry-list"
            defaultSize={36}
            minSize={24}
            className="flex flex-col bg-card rounded-xl border shadow-sm overflow-hidden"
          >
            <MaintenanceEntryList />
          </ResizablePanel>

          <ResizableHandle className="w-1 bg-transparent hover:bg-primary/10 rounded-full" />

          <ResizablePanel
            id="maintenance-detail-view"
            defaultSize={64}
            minSize={30}
            className="flex flex-col bg-card rounded-xl border shadow-sm overflow-hidden"
          >
            <MaintenanceDetailView />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <div className="flex items-center justify-between border-t bg-background px-8 py-3 text-xs font-medium text-muted-foreground">
        <div className="flex max-w-[70%] items-center gap-4 truncate">
          {executionStatus !== "idle" && (
            <div className="flex items-center gap-2 text-primary animate-pulse">
              <div className="h-1.5 w-1.5 rounded-full bg-current" />
              {executionStatus === "scanning" ? "正在扫描" : executionStatus === "stopping" ? "正在停止" : "正在维护"}
            </div>
          )}
          <span className="truncate opacity-70">{currentPath || "就绪"}</span>
        </div>
        {statusText && <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs">{statusText}</span>}
      </div>
    </div>
  );
}

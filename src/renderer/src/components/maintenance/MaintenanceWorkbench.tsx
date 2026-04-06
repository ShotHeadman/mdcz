import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { DetailPanel } from "@/components/DetailPanel";
import { toDetailViewItemFromMaintenanceEntry } from "@/components/detail/detailViewAdapters";
import MaintenanceEntryList from "@/components/maintenance/MaintenanceEntryList";
import { WorkbenchFooter } from "@/components/shared/WorkbenchFooter";
import { Progress } from "@/components/ui/Progress";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/Resizable";
import { findMaintenanceEntryGroup } from "@/lib/maintenanceGrouping";
import { useMaintenanceEntryStore } from "@/store/maintenanceEntryStore";
import { useMaintenanceExecutionStore } from "@/store/maintenanceExecutionStore";
import { useMaintenancePreviewStore } from "@/store/maintenancePreviewStore";

export default function MaintenanceWorkbench() {
  const { currentPath, entries, activeId, presetId } = useMaintenanceEntryStore(
    useShallow((state) => ({
      currentPath: state.currentPath,
      entries: state.entries,
      activeId: state.activeId,
      presetId: state.presetId,
    })),
  );
  const { executionStatus, progressValue, statusText, itemResults } = useMaintenanceExecutionStore(
    useShallow((state) => ({
      executionStatus: state.executionStatus,
      progressValue: state.progressValue,
      statusText: state.statusText,
      itemResults: state.itemResults,
    })),
  );
  const { previewResults, fieldSelections, setFieldSelection } = useMaintenancePreviewStore(
    useShallow((state) => ({
      previewResults: state.previewResults,
      fieldSelections: state.fieldSelections,
      setFieldSelection: state.setFieldSelection,
    })),
  );

  const showProgress = executionStatus === "executing" || executionStatus === "stopping";
  const activeGroup = useMemo(
    () => findMaintenanceEntryGroup(entries, activeId, { itemResults, previewResults }) ?? null,
    [activeId, entries, itemResults, previewResults],
  );
  const compareResult = activeGroup?.compareResult;
  const detailEntry = useMemo(() => {
    if (!activeGroup) {
      return null;
    }

    const comparedFileId = compareResult && "fileId" in compareResult ? compareResult.fileId : undefined;
    return (
      activeGroup.items.find((entry) => entry.fileId === comparedFileId) ??
      activeGroup.items.find((entry) => entry.fileId === activeId) ??
      activeGroup.representative
    );
  }, [activeGroup, activeId, compareResult]);
  const detailPreview = useMemo(() => {
    if (!activeGroup || !detailEntry) {
      return undefined;
    }

    return (
      activeGroup.previewItems.find((item) => item.fileId === detailEntry.fileId) ??
      activeGroup.previewItems.find((item) => item.fileId === activeId)
    );
  }, [activeGroup, activeId, detailEntry]);
  const usesDiffView = presetId === "refresh_data" || presetId === "rebuild_all";
  const detailItem = useMemo(() => {
    if (!activeGroup || !detailEntry) {
      return null;
    }

    const baseItem = toDetailViewItemFromMaintenanceEntry(detailEntry, compareResult);
    return {
      ...baseItem,
      status:
        activeGroup.status === "failed"
          ? "failed"
          : activeGroup.status === "success"
            ? "success"
            : activeGroup.status === "processing"
              ? "processing"
              : baseItem.status,
      errorMessage: activeGroup.errorText ?? baseItem.errorMessage,
    };
  }, [activeGroup, compareResult, detailEntry]);
  const activeLabel =
    executionStatus === "idle"
      ? undefined
      : executionStatus === "scanning"
        ? "正在扫描"
        : executionStatus === "stopping"
          ? "正在停止"
          : "正在维护";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {showProgress && (
        <div className="px-8 pt-4 pb-0">
          <div className="flex items-center gap-4 rounded-lg border bg-card p-1">
            <Progress value={progressValue} className="ml-3 h-2 flex-1" />
            <span className="w-12 text-[10px] font-bold tabular-nums text-primary">{Math.round(progressValue)}%</span>
          </div>
        </div>
      )}

      <div className="flex flex-1 min-h-0 p-4">
        <ResizablePanelGroup orientation="horizontal" className="flex-1">
          <ResizablePanel
            id="maintenance-entry-list"
            defaultSize={36}
            minSize={24}
            className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm"
          >
            <MaintenanceEntryList />
          </ResizablePanel>

          <ResizableHandle className="w-1 rounded-full bg-transparent hover:bg-primary/10" />

          <ResizablePanel
            id="maintenance-detail-view"
            defaultSize={64}
            minSize={30}
            className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm"
          >
            <DetailPanel
              item={detailItem}
              compare={
                usesDiffView
                  ? {
                      result: compareResult,
                      badgeLabel: "数据对比",
                      entry: detailEntry ?? undefined,
                      preview: detailPreview,
                      fieldSelections: detailEntry ? fieldSelections[detailEntry.fileId] : undefined,
                      onFieldSelectionChange: setFieldSelection,
                    }
                  : undefined
              }
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <WorkbenchFooter activeLabel={activeLabel} currentPath={currentPath} statusText={statusText} />
    </div>
  );
}

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { DetailPanel } from "@/components/DetailPanel";
import { toDetailViewItemFromMaintenanceEntry } from "@/components/detail/detailViewAdapters";
import MaintenanceEntryList from "@/components/maintenance/MaintenanceEntryList";
import { WorkbenchFooter } from "@/components/shared/WorkbenchFooter";
import { Progress } from "@/components/ui/Progress";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/Resizable";
import { findMaintenanceEntryGroup } from "@/lib/maintenanceGrouping";
import { useMaintenanceStore } from "@/store/maintenanceStore";

export default function MaintenanceWorkbench() {
  const {
    executionStatus,
    progressValue,
    currentPath,
    statusText,
    entries,
    activeId,
    presetId,
    previewResults,
    itemResults,
  } = useMaintenanceStore(
    useShallow((state) => ({
      executionStatus: state.executionStatus,
      progressValue: state.progressValue,
      currentPath: state.currentPath,
      statusText: state.statusText,
      entries: state.entries,
      activeId: state.activeId,
      presetId: state.presetId,
      previewResults: state.previewResults,
      itemResults: state.itemResults,
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

    const comparedEntryId = compareResult && "entryId" in compareResult ? compareResult.entryId : undefined;
    return (
      activeGroup.items.find((entry) => entry.id === comparedEntryId) ??
      activeGroup.items.find((entry) => entry.id === activeId) ??
      activeGroup.representative
    );
  }, [activeGroup, activeId, compareResult]);
  const usesDiffView = presetId === "refresh_data" || presetId === "rebuild_all";
  const detailItem = useMemo(() => {
    if (!activeGroup || !detailEntry) {
      return null;
    }

    const baseItem = toDetailViewItemFromMaintenanceEntry(detailEntry, compareResult);
    return {
      ...baseItem,
      status:
        activeGroup.status === "failed" ? "failed" : activeGroup.status === "success" ? "success" : baseItem.status,
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

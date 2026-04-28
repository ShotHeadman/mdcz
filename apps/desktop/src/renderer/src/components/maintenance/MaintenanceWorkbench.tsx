import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { DetailPanel } from "@/components/DetailPanel";
import { toDetailViewItemFromMaintenanceEntry } from "@/components/detail/detailViewAdapters";
import MaintenanceEntryList from "@/components/maintenance/MaintenanceEntryList";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/Resizable";
import { findMaintenanceEntryGroup } from "@/lib/maintenanceGrouping";
import { useMaintenanceEntryStore } from "@/store/maintenanceEntryStore";
import { useMaintenanceExecutionStore } from "@/store/maintenanceExecutionStore";
import { useMaintenancePreviewStore } from "@/store/maintenancePreviewStore";
import { FloatingWorkbenchBar } from "../shared/FloatingWorkbenchBar";
import MaintenanceBatchBar from "./MaintenanceBatchBar";

interface MaintenanceWorkbenchProps {
  mediaPath?: string;
}

export default function MaintenanceWorkbench({ mediaPath }: MaintenanceWorkbenchProps) {
  const { entries, activeId, presetId } = useMaintenanceEntryStore(
    useShallow((state) => ({
      entries: state.entries,
      activeId: state.activeId,
      presetId: state.presetId,
    })),
  );
  const itemResults = useMaintenanceExecutionStore((state) => state.itemResults);
  const { previewResults, fieldSelections, setFieldSelection } = useMaintenancePreviewStore(
    useShallow((state) => ({
      previewResults: state.previewResults,
      fieldSelections: state.fieldSelections,
      setFieldSelection: state.setFieldSelection,
    })),
  );

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

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-surface-canvas">
      <div className="flex flex-1 min-h-0 p-4 md:p-6 lg:p-8">
        <ResizablePanelGroup orientation="horizontal" className="flex-1 gap-3">
          <ResizablePanel
            id="maintenance-entry-list"
            defaultSize={36}
            minSize={24}
            className="flex flex-col overflow-hidden rounded-quiet-lg bg-surface-low/80"
          >
            <MaintenanceEntryList />
          </ResizablePanel>

          <ResizableHandle className="w-1 rounded-full bg-transparent hover:bg-foreground/10" />

          <ResizablePanel
            id="maintenance-detail-view"
            defaultSize={64}
            minSize={30}
            className="flex flex-col overflow-hidden rounded-quiet-lg bg-surface-floating/94"
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
      <FloatingWorkbenchBar contentClassName="mx-auto flex w-fit max-w-[min(92vw,42rem)] items-center gap-3 px-3 py-2.5 md:px-4">
        <MaintenanceBatchBar mediaPath={mediaPath} />
      </FloatingWorkbenchBar>
    </div>
  );
}

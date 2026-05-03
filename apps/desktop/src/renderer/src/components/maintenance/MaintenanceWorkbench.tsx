import { MaintenanceWorkbenchFrame } from "@mdcz/views/workbench";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { DetailPanel } from "@/components/DetailPanel";
import { toDetailViewItemFromMaintenanceEntry } from "@/components/detail/detailViewAdapters";
import MaintenanceBatchBar from "@/components/maintenance/MaintenanceBatchBar";
import MaintenanceEntryList from "@/components/maintenance/MaintenanceEntryList";
import { findMaintenanceEntryGroup } from "@/lib/maintenanceGrouping";
import { useMaintenanceEntryStore } from "@/store/maintenanceEntryStore";
import { useMaintenanceExecutionStore } from "@/store/maintenanceExecutionStore";
import { useMaintenancePreviewStore } from "@/store/maintenancePreviewStore";

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
    <MaintenanceWorkbenchFrame
      list={<MaintenanceEntryList />}
      detail={
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
      }
      batchBar={<MaintenanceBatchBar mediaPath={mediaPath} />}
    />
  );
}

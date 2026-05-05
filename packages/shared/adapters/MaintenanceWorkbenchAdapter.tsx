import { toDetailViewItemFromMaintenanceEntry } from "@mdcz/views/detail";
import { MaintenanceWorkbenchFrame } from "@mdcz/views/workbench";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useMaintenanceEntryStore } from "../stores/maintenanceEntryStore";
import { useMaintenanceExecutionStore } from "../stores/maintenanceExecutionStore";
import { useMaintenancePreviewStore } from "../stores/maintenancePreviewStore";
import { findMaintenanceEntryGroup } from "../viewModels/maintenanceGrouping";
import { DetailPanelAdapter } from "./DetailPanelAdapter";
import { MaintenanceBatchBarAdapter } from "./MaintenanceBatchBarAdapter";
import { MaintenanceEntryListAdapter } from "./MaintenanceEntryListAdapter";
import type { SharedWorkbenchPorts } from "./ports";

export function MaintenanceWorkbenchAdapter({ ports }: { ports: SharedWorkbenchPorts }) {
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
      list={<MaintenanceEntryListAdapter port={ports.maintenance} />}
      detail={
        <DetailPanelAdapter
          port={ports.detail}
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
      batchBar={<MaintenanceBatchBarAdapter port={ports.maintenance} />}
    />
  );
}

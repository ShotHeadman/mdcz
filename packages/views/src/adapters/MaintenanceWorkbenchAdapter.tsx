import { toErrorMessage } from "@mdcz/shared/error";
import type { MaintenanceSessionStatus } from "@mdcz/shared/maintenanceTasks";
import { findMaintenanceEntryGroup } from "@mdcz/shared/viewModels/maintenanceGrouping";
import {
  applyMaintenanceSessionSnapshot,
  selectMaintenanceEntries,
  selectMaintenanceFieldSelections,
  selectMaintenanceItemResults,
  selectMaintenancePreviewResults,
  useMaintenanceStore,
} from "@mdcz/views/state/maintenanceStore";
import { CircleCheck, CircleStop, Loader2, SearchX, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { toDetailViewItemFromMaintenanceEntry } from "../detail";
import { useT } from "../i18n";
import { MaintenanceWorkbenchFrame, type WorkbenchTaskStateContent, WorkbenchTaskStatePanel } from "../workbench";
import { DetailPanelAdapter } from "./DetailPanelAdapter";
import { MaintenanceBatchBarAdapter } from "./MaintenanceBatchBarAdapter";
import { MaintenanceEntryListAdapter } from "./MaintenanceEntryListAdapter";
import type { SharedWorkbenchPorts } from "./ports";

export function MaintenanceWorkbenchAdapter({ ports }: { ports: SharedWorkbenchPorts }) {
  const t = useT();
  const snapshot = useMaintenanceStore((state) => state.snapshot);
  const { entries, activeId, presetId } = useMaintenanceStore(
    useShallow((state) => ({
      entries: selectMaintenanceEntries(state),
      activeId: state.activeId,
      presetId: state.presetId,
    })),
  );
  const itemResults = useMaintenanceStore(selectMaintenanceItemResults);
  const { previewResults, fieldSelections } = useMaintenanceStore(
    useShallow((state) => ({
      previewResults: selectMaintenancePreviewResults(state),
      fieldSelections: selectMaintenanceFieldSelections(state),
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
  const usesDiffView = presetId === "refresh_metadata" || presetId === "remerge" || presetId === "rebuild_all";
  const handleFieldSelectionChange = (
    fileId: string,
    field: import("@mdcz/shared/types").FieldDiff["field"],
    side: import("../maintenance").MaintenanceFieldSelectionSide,
  ) => {
    const state = useMaintenanceStore.getState();
    const previewId = selectMaintenancePreviewResults(state)[fileId]?.previewId;
    if (!previewId) return;
    const selections = { ...selectMaintenanceFieldSelections(state)[fileId], [field]: side };
    void ports.maintenance
      .updateDraft(previewId, { fieldSelections: selections })
      .then(async () => applyMaintenanceSessionSnapshot(await ports.maintenance.getActiveSession()))
      .catch((error) => toast.error(t.maintenance.saveSelectionsFailed(toErrorMessage(error))));
  };
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

  const maintenanceEmptyStates: Partial<Record<MaintenanceSessionStatus, WorkbenchTaskStateContent>> = {
    queued: { icon: Loader2, tone: "active", title: t.maintenance.queued },
    discovering: { icon: Loader2, tone: "active", title: t.maintenance.scanningFiles },
    stopping: { icon: Loader2, tone: "active", title: t.maintenance.stoppingWaitingCurrent },
    stopped: { icon: CircleStop, tone: "muted", title: t.maintenance.taskStopped },
    completed:
      snapshot?.totalEntries === 0
        ? { icon: SearchX, tone: "muted", title: t.maintenance.noVideosToProcess }
        : { icon: CircleCheck, tone: "muted", title: t.maintenance.taskCompleted },
  };

  return (
    <MaintenanceWorkbenchFrame
      list={<MaintenanceEntryListAdapter port={ports.maintenance} />}
      detail={
        entries.length === 0 && snapshot ? (
          <WorkbenchTaskStatePanel
            {...(maintenanceEmptyStates[snapshot.status] ??
              (snapshot.error
                ? { icon: TriangleAlert, tone: "error", title: snapshot.error }
                : { icon: Loader2, tone: "active", title: t.maintenance.readingLocalFiles }))}
            path={snapshot.directoryScope?.scanDir}
            discovery={snapshot.discovery}
          />
        ) : (
          <div className="flex h-full flex-col overflow-auto">
            {snapshot?.previews.find((preview) => preview.entry?.fileId === detailEntry?.fileId)?.affectedFiles
              ?.length ? (
              <section className="space-y-2 border-b p-4 text-sm">
                <h3 className="font-semibold">{t.maintenance.fileChanges}</h3>
                {snapshot.previews
                  .find((preview) => preview.entry?.fileId === detailEntry?.fileId)
                  ?.affectedFiles?.map((file) => (
                    <p className="break-all" key={file.fileId}>
                      {file.currentPath}
                      {file.targetPath !== file.currentPath ? ` → ${file.targetPath}` : ""}
                    </p>
                  ))}
              </section>
            ) : null}
            <DetailPanelAdapter
              port={ports.detail}
              item={detailItem}
              compare={
                usesDiffView
                  ? {
                      result: compareResult,
                      badgeLabel: t.maintenance.dataCompare,
                      entry: detailEntry ?? undefined,
                      preview: detailPreview,
                      fieldSelections: detailEntry ? fieldSelections[detailEntry.fileId] : undefined,
                      onFieldSelectionChange: handleFieldSelectionChange,
                    }
                  : undefined
              }
            />
          </div>
        )
      }
      batchBar={<MaintenanceBatchBarAdapter port={ports.maintenance} />}
    />
  );
}

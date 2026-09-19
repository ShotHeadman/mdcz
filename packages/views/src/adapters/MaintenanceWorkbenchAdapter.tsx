import { toErrorMessage } from "@mdcz/shared/error";
import { findMaintenanceEntryGroup } from "@mdcz/shared/viewModels/maintenanceGrouping";
import {
  applyMaintenanceSessionSnapshot,
  selectMaintenanceEntries,
  selectMaintenanceFieldSelections,
  selectMaintenanceItemResults,
  selectMaintenancePreviewResults,
  useMaintenanceStore,
} from "@mdcz/views/state/maintenanceStore";
import { useMemo } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { toDetailViewItemFromMaintenanceEntry } from "../detail";
import { MaintenanceWorkbenchFrame } from "../workbench";
import { DetailPanelAdapter } from "./DetailPanelAdapter";
import { MaintenanceBatchBarAdapter } from "./MaintenanceBatchBarAdapter";
import { MaintenanceEntryListAdapter } from "./MaintenanceEntryListAdapter";
import type { SharedWorkbenchPorts } from "./ports";

export function MaintenanceWorkbenchAdapter({ ports }: { ports: SharedWorkbenchPorts }) {
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
  const usesDiffView = presetId === "refresh_metadata" || presetId === "rebuild_all";
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
      .catch((error) => toast.error(`保存维护选择失败: ${toErrorMessage(error)}`));
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

  return (
    <MaintenanceWorkbenchFrame
      list={<MaintenanceEntryListAdapter port={ports.maintenance} />}
      detail={
        entries.length === 0 && snapshot ? (
          <div role="status" className="space-y-4 p-8">
            <h2 className="text-lg font-semibold">
              {snapshot.status === "discovering"
                ? "正在扫描维护文件"
                : snapshot.status === "queued"
                  ? "维护任务已排队"
                  : snapshot.status === "stopping"
                    ? "正在停止，等待当前文件处理完成"
                    : snapshot.status === "completed"
                      ? snapshot.totalEntries === 0
                        ? "未找到可维护视频"
                        : "维护任务已完成"
                      : (snapshot.error ?? "正在读取本地文件")}
            </h2>
            <p className="break-all text-sm">{snapshot.directoryScope?.scanDir}</p>
            {snapshot.discovery ? (
              <>
                <p>
                  已扫描 {snapshot.discovery.directories} 个目录，找到 {snapshot.discovery.candidates} 个视频，跳过{" "}
                  {snapshot.discovery.skipped} 项
                </p>
                <p className="break-all text-sm">{snapshot.discovery.currentPath}</p>
                <p className="break-all text-amber-600">{snapshot.discovery.warnings.join("、")}</p>
              </>
            ) : null}
          </div>
        ) : (
          <div className="flex h-full flex-col overflow-auto">
            {snapshot?.previews.find((preview) => preview.entry?.fileId === detailEntry?.fileId)?.affectedFiles
              ?.length ? (
              <section className="space-y-2 border-b p-4 text-sm">
                <h3 className="font-semibold">影片受影响文件</h3>
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
                      badgeLabel: "数据对比",
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

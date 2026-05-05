import { toErrorMessage } from "@mdcz/shared/error";
import { getMaintenancePresetMeta } from "@mdcz/shared/maintenancePresets";
import type { LocalScanEntry } from "@mdcz/shared/types";
import { ContextMenuItem } from "@mdcz/ui";
import type { MediaBrowserItemStatus } from "@mdcz/views/common";
import { MaintenanceEntryListView, type MaintenanceEntryListViewItem } from "@mdcz/views/maintenance";
import { FileText, FolderOpen, Play } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { type MaintenanceFilter, useMaintenanceEntryStore } from "../stores/maintenanceEntryStore";
import { useMaintenanceExecutionStore } from "../stores/maintenanceExecutionStore";
import { useMaintenancePreviewStore } from "../stores/maintenancePreviewStore";
import { toggleMaintenanceSelectedIds } from "../stores/maintenanceSession";
import { buildMaintenanceEntryViewModel, type MaintenanceEntryGroupViewModel } from "../viewModels/maintenanceGrouping";
import type { ActionAvailability, MaintenanceActionPort } from "./ports";

const getTitle = (entry: LocalScanEntry) =>
  entry.crawlerData?.title_zh ?? entry.crawlerData?.title ?? entry.fileInfo.fileName;

const statusWeight = (status: MediaBrowserItemStatus): number => {
  if (status === "success") return 0;
  if (status === "failed") return 1;
  if (status === "processing") return 2;
  return 3;
};

const matchesFilter = (filter: MaintenanceFilter, status: MediaBrowserItemStatus): boolean => {
  if (filter === "all") return true;
  return status === filter;
};

const buildGroupSubtitle = (group: MaintenanceEntryGroupViewModel): string => {
  const baseTitle = getTitle(group.representative);
  if (group.items.length <= 1) {
    return baseTitle;
  }

  return `${baseTitle} · 共 ${group.items.length} 个分盘文件`;
};

const isActionVisible = (availability: ActionAvailability | undefined) => availability !== "hidden";

function buildMenuContent(entry: LocalScanEntry, port: MaintenanceActionPort) {
  const handleOpenFolder = async () => {
    const filePath = entry.fileInfo.filePath.trim();
    if (!filePath) {
      toast.info("无可打开的文件路径");
      return;
    }

    try {
      await port.openFolder(filePath);
    } catch (error) {
      toast.error(`打开目录失败: ${toErrorMessage(error)}`);
    }
  };

  const handlePlay = () => void port.play(entry.fileInfo.filePath);

  const handleOpenNfo = () => {
    void port.openNfo(entry.nfoPath ?? entry.fileInfo.filePath);
  };

  return (
    <>
      {isActionVisible(port.capabilities?.openFolder) ? (
        <ContextMenuItem onClick={handleOpenFolder}>
          <FolderOpen className="mr-2 h-4 w-4" />
          打开目录
        </ContextMenuItem>
      ) : null}
      {isActionVisible(port.capabilities?.play) ? (
        <ContextMenuItem onClick={handlePlay}>
          <Play className="mr-2 h-4 w-4" />
          播放
        </ContextMenuItem>
      ) : null}
      {isActionVisible(port.capabilities?.openNfo) ? (
        <ContextMenuItem onClick={handleOpenNfo}>
          <FileText className="mr-2 h-4 w-4" />
          编辑 NFO
        </ContextMenuItem>
      ) : null}
    </>
  );
}

export function MaintenanceEntryListAdapter({ port }: { port: MaintenanceActionPort }) {
  const { entries, selectedIds, activeId, filter, presetId, setFilter, setActiveId } = useMaintenanceEntryStore(
    useShallow((state) => ({
      entries: state.entries,
      selectedIds: state.selectedIds,
      activeId: state.activeId,
      filter: state.filter,
      presetId: state.presetId,
      setFilter: state.setFilter,
      setActiveId: state.setActiveId,
    })),
  );
  const { itemResults, executionStatus } = useMaintenanceExecutionStore(
    useShallow((state) => ({
      itemResults: state.itemResults,
      executionStatus: state.executionStatus,
    })),
  );
  const previewResults = useMaintenancePreviewStore((state) => state.previewResults);
  const showsSelection = getMaintenancePresetMeta(presetId).supportsExecution !== false;
  const selectionLocked = executionStatus !== "idle";
  const groupedEntries = useMemo(
    () => buildMaintenanceEntryViewModel(entries, { itemResults, previewResults }).groups,
    [entries, itemResults, previewResults],
  );

  const sortedEntries = useMemo(
    () =>
      [...groupedEntries].sort((left, right) => {
        const weightDiff = statusWeight(left.status) - statusWeight(right.status);
        if (weightDiff !== 0) return weightDiff;
        return left.representative.fileInfo.number.localeCompare(right.representative.fileInfo.number);
      }),
    [groupedEntries],
  );

  const visibleEntries = sortedEntries.filter((group) => matchesFilter(filter, group.status));
  const visibleIds = visibleEntries.flatMap((group) => group.items.map((entry) => entry.fileId));
  const isGroupFullySelected = (group: MaintenanceEntryGroupViewModel): boolean =>
    group.items.every((entry) => selectedIds.includes(entry.fileId));
  const isGroupPartiallySelected = (group: MaintenanceEntryGroupViewModel): boolean =>
    group.items.some((entry) => selectedIds.includes(entry.fileId)) && !isGroupFullySelected(group);
  const allVisibleSelected = visibleEntries.length > 0 && visibleEntries.every((group) => isGroupFullySelected(group));
  const someVisibleSelected = visibleEntries.some(
    (group) => isGroupPartiallySelected(group) || isGroupFullySelected(group),
  );
  const selectedCount = groupedEntries.filter((group) =>
    group.items.some((entry) => selectedIds.includes(entry.fileId)),
  ).length;
  const selectedVisibleCount = visibleEntries.filter((group) => isGroupFullySelected(group)).length;
  const blockedCount = groupedEntries.filter((group) => group.status === "failed").length;
  const processingCount = groupedEntries.filter((group) => group.status === "processing").length;

  const items: MaintenanceEntryListViewItem[] = sortedEntries.map((group) => {
    const representative = group.representative;
    const checkedState = isGroupFullySelected(group) ? true : isGroupPartiallySelected(group) ? "indeterminate" : false;

    return {
      id: group.id,
      active: group.items.some((entry) => activeId === entry.fileId),
      title: representative.fileInfo.number,
      subtitle: buildGroupSubtitle(group),
      errorText: group.errorText,
      status: group.status,
      selected: checkedState,
      selectionDisabled: selectionLocked,
      onSelectionChange: showsSelection
        ? () => {
            toggleMaintenanceSelectedIds(group.items.map((entry) => entry.fileId));
          }
        : undefined,
      onClick: () =>
        setActiveId(group.items.find((entry) => entry.fileId === activeId)?.fileId ?? representative.fileId),
      menuContent: buildMenuContent(group.items.find((entry) => entry.fileId === activeId) ?? representative, port),
    };
  });

  return (
    <MaintenanceEntryListView
      items={items}
      filter={filter}
      onFilterChange={(nextFilter) => setFilter(nextFilter)}
      showSelection={showsSelection}
      selectionDisabled={selectionLocked}
      allVisibleSelected={allVisibleSelected}
      someVisibleSelected={someVisibleSelected}
      selectedVisibleCount={selectedVisibleCount}
      visibleCount={visibleEntries.length}
      visibleIdsCount={visibleIds.length}
      onToggleVisibleSelection={() => {
        toggleMaintenanceSelectedIds(visibleIds);
      }}
      stats={[
        { label: "总计", value: String(groupedEntries.length) },
        ...(showsSelection ? [{ label: "已选", value: String(selectedCount) }] : []),
        { label: "处理中", value: String(processingCount) },
        { label: "异常", value: String(blockedCount), tone: "negative" },
      ]}
    />
  );
}

export default MaintenanceEntryListAdapter;

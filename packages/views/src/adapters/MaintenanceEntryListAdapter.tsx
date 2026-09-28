import { toErrorMessage } from "@mdcz/shared/error";
import type { LocalScanEntry } from "@mdcz/shared/types";
import {
  buildMaintenanceEntryViewModel,
  type MaintenanceEntryGroupViewModel,
} from "@mdcz/shared/viewModels/maintenanceGrouping";
import { ContextMenuItem } from "@mdcz/ui";
import {
  type MaintenanceFilter,
  selectMaintenanceEntries,
  selectMaintenanceExecutionStatus,
  selectMaintenanceItemResults,
  selectMaintenancePreviewResults,
  toggleMaintenanceSelectedIds,
  useMaintenanceStore,
} from "@mdcz/views/state/maintenanceStore";
import { FileText, FolderOpen, Play } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import type { MediaBrowserItemStatus } from "../common";
import { type Messages, useT } from "../i18n";
import { MaintenanceEntryListView, type MaintenanceEntryListViewItem } from "../maintenance";
import type { MaintenanceActionPort } from "./ports";

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

const buildGroupSubtitle = (t: Messages, group: MaintenanceEntryGroupViewModel): string => {
  const baseTitle = getTitle(group.representative);
  if (group.items.length <= 1) {
    return baseTitle;
  }

  return t.maintenance.multiPartTitle(baseTitle, group.items.length);
};

function buildMenuContent(t: Messages, entry: LocalScanEntry, port: MaintenanceActionPort) {
  const handleOpenFolder = async () => {
    const filePath = entry.fileInfo.filePath.trim();
    if (!filePath) {
      toast.info(t.maintenance.noOpenablePath);
      return;
    }

    try {
      await port.openFolder?.(filePath);
    } catch (error) {
      toast.error(t.maintenance.openFolderFailed(toErrorMessage(error)));
    }
  };

  const handlePlay = () => void port.play?.(entry.fileInfo.filePath);

  const handleOpenNfo = () => {
    void port.openNfo(entry.nfoPath ?? entry.fileInfo.filePath);
  };

  return (
    <>
      {typeof port.openFolder === "function" ? (
        <ContextMenuItem onClick={handleOpenFolder}>
          <FolderOpen className="mr-2 h-4 w-4" />
          {t.maintenance.openFolder}
        </ContextMenuItem>
      ) : null}
      {typeof port.play === "function" ? (
        <ContextMenuItem onClick={handlePlay}>
          <Play className="mr-2 h-4 w-4" />
          {t.maintenance.play}
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem onClick={handleOpenNfo}>
        <FileText className="mr-2 h-4 w-4" />
        {t.maintenance.editNfo}
      </ContextMenuItem>
    </>
  );
}

export function MaintenanceEntryListAdapter({ port }: { port: MaintenanceActionPort }) {
  const t = useT();
  const { entries, selectedIds, activeId, filter, setFilter, setActiveId } = useMaintenanceStore(
    useShallow((state) => ({
      entries: selectMaintenanceEntries(state),
      selectedIds: state.selectedIds,
      activeId: state.activeId,
      filter: state.filter,
      setFilter: state.setFilter,
      setActiveId: state.setActiveId,
    })),
  );
  const { itemResults, executionStatus, pending } = useMaintenanceStore(
    useShallow((state) => ({
      itemResults: selectMaintenanceItemResults(state),
      executionStatus: selectMaintenanceExecutionStatus(state),
      pending: state.pending,
    })),
  );
  const previewResults = useMaintenanceStore(selectMaintenancePreviewResults);
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
      subtitle: buildGroupSubtitle(t, group),
      errorText: group.errorText,
      status: group.status,
      selected: checkedState,
      selectionDisabled: selectionLocked,
      onSelectionChange: () => {
        toggleMaintenanceSelectedIds(group.items.map((entry) => entry.fileId));
      },
      onClick: () =>
        setActiveId(group.items.find((entry) => entry.fileId === activeId)?.fileId ?? representative.fileId),
      menuContent: buildMenuContent(t, group.items.find((entry) => entry.fileId === activeId) ?? representative, port),
    };
  });

  return (
    <MaintenanceEntryListView
      items={items}
      loading={pending || executionStatus === "previewing"}
      filter={filter}
      onFilterChange={(nextFilter) => setFilter(nextFilter)}
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
        { label: t.maintenance.metrics.total, value: String(groupedEntries.length) },
        { label: t.maintenance.metrics.selected, value: String(selectedCount) },
        { label: t.maintenance.metrics.processing, value: String(processingCount) },
        { label: t.maintenance.metrics.blocked, value: String(blockedCount), tone: "negative" },
      ]}
    />
  );
}

export default MaintenanceEntryListAdapter;

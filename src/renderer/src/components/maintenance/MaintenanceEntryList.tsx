import type { LocalScanEntry, MaintenanceItemResult } from "@shared/types";
import { FileText, FolderOpen, Play } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import {
  type MediaBrowserItem,
  type MediaBrowserItemStatus,
  MediaBrowserList,
} from "@/components/shared/MediaBrowserList";
import { Checkbox } from "@/components/ui/Checkbox";
import { ContextMenuItem } from "@/components/ui/ContextMenu";
import { type MaintenanceFilter, useMaintenanceStore } from "@/store/maintenanceStore";

const getTitle = (entry: LocalScanEntry) =>
  entry.crawlerData?.title_zh ?? entry.crawlerData?.title ?? entry.fileInfo.fileName;

const getEntryStatus = (entry: LocalScanEntry, result?: MaintenanceItemResult): MediaBrowserItemStatus => {
  if (result?.status === "success") return "success";
  if (result?.status === "failed") return "failed";
  if (result?.status === "processing") return "processing";
  if (entry.scanError) return "failed";
  return "idle";
};

const statusWeight = (entry: LocalScanEntry, result?: MaintenanceItemResult): number => {
  const status = getEntryStatus(entry, result);
  if (status === "success") return 0;
  if (status === "failed") return 1;
  if (status === "processing") return 2;
  return 3;
};

const matchesFilter = (filter: MaintenanceFilter, entry: LocalScanEntry, result?: MaintenanceItemResult): boolean => {
  if (filter === "all") return true;
  return getEntryStatus(entry, result) === filter;
};

function buildMenuContent(entry: LocalScanEntry) {
  const handleOpenFolder = () => {
    if (!window.electron?.openPath) {
      toast.info("打开目录功能仅在桌面客户端可用");
      return;
    }
    const slash = Math.max(entry.videoPath.lastIndexOf("/"), entry.videoPath.lastIndexOf("\\"));
    const dir = slash > 0 ? entry.videoPath.slice(0, slash) : entry.videoPath;
    void window.electron.openPath(dir);
  };

  const handlePlay = () => {
    if (!window.electron?.openPath) {
      toast.info("播放功能仅在桌面客户端可用");
      return;
    }
    void window.electron.openPath(entry.videoPath);
  };

  const handleOpenNfo = () => {
    window.dispatchEvent(new CustomEvent("app:open-nfo", { detail: { path: entry.nfoPath ?? entry.videoPath } }));
  };

  return (
    <>
      <ContextMenuItem onClick={handleOpenFolder}>
        <FolderOpen className="mr-2 h-4 w-4" />
        打开目录
      </ContextMenuItem>
      <ContextMenuItem onClick={handlePlay}>
        <Play className="mr-2 h-4 w-4" />
        播放
      </ContextMenuItem>
      <ContextMenuItem onClick={handleOpenNfo}>
        <FileText className="mr-2 h-4 w-4" />
        编辑 NFO
      </ContextMenuItem>
    </>
  );
}

export default function MaintenanceEntryList() {
  const {
    entries,
    selectedIds,
    activeId,
    filter,
    itemResults,
    executionStatus,
    setFilter,
    toggleSelectAll,
    setActiveId,
    toggleSelected,
  } = useMaintenanceStore(
    useShallow((state) => ({
      entries: state.entries,
      selectedIds: state.selectedIds,
      activeId: state.activeId,
      filter: state.filter,
      itemResults: state.itemResults,
      executionStatus: state.executionStatus,
      setFilter: state.setFilter,
      toggleSelectAll: state.toggleSelectAll,
      setActiveId: state.setActiveId,
      toggleSelected: state.toggleSelected,
    })),
  );

  const selectionLocked = executionStatus === "executing" || executionStatus === "stopping";

  const sortedEntries = useMemo(
    () =>
      [...entries].sort((left, right) => {
        const weightDiff = statusWeight(left, itemResults[left.id]) - statusWeight(right, itemResults[right.id]);
        if (weightDiff !== 0) return weightDiff;
        return left.fileInfo.number.localeCompare(right.fileInfo.number);
      }),
    [entries, itemResults],
  );

  const visibleEntries = sortedEntries.filter((entry) => matchesFilter(filter, entry, itemResults[entry.id]));
  const visibleIds = visibleEntries.map((entry) => entry.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const selectedVisibleCount = visibleIds.filter((id) => selectedIds.includes(id)).length;

  const items = useMemo<MediaBrowserItem[]>(
    () =>
      sortedEntries.map((entry) => {
        const result = itemResults[entry.id];

        return {
          id: entry.id,
          active: activeId === entry.id,
          title: entry.fileInfo.number,
          subtitle: getTitle(entry),
          errorText: result?.error ?? entry.scanError,
          status: getEntryStatus(entry, result),
          selectionControl: (
            <Checkbox
              checked={selectedIds.includes(entry.id)}
              disabled={selectionLocked}
              onCheckedChange={() => toggleSelected(entry.id)}
              onClick={(event) => event.stopPropagation()}
            />
          ),
          onClick: () => setActiveId(entry.id),
          menuContent: buildMenuContent(entry),
        };
      }),
    [activeId, itemResults, selectedIds, selectionLocked, setActiveId, sortedEntries, toggleSelected],
  );

  return (
    <MediaBrowserList
      items={items}
      filter={filter}
      onFilterChange={(nextFilter) => setFilter(nextFilter)}
      emptyMessage="扫描完成后，维护项目会显示在这里。"
      headerLeading={
        <>
          <Checkbox
            id="maintenance-select-all"
            checked={allVisibleSelected}
            disabled={selectionLocked || visibleIds.length === 0}
            onCheckedChange={() => toggleSelectAll(visibleIds)}
          />
          <label htmlFor="maintenance-select-all" className="cursor-pointer">
            全选 ({selectedVisibleCount}/{visibleEntries.length})
          </label>
        </>
      }
    />
  );
}

import type { LocalScanEntry } from "@shared/types";
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
import { buildMaintenanceEntryGroups, type MaintenanceEntryGroup } from "@/lib/maintenanceGrouping";
import { type MaintenanceFilter, useMaintenanceStore } from "@/store/maintenanceStore";

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

const buildGroupSubtitle = (group: MaintenanceEntryGroup): string => {
  const baseTitle = getTitle(group.representative);
  if (group.items.length <= 1) {
    return baseTitle;
  }

  return `${baseTitle} · 共 ${group.items.length} 个分盘文件`;
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
    toggleSelectedIds,
    toggleSelectAll,
    setActiveId,
  } = useMaintenanceStore(
    useShallow((state) => ({
      entries: state.entries,
      selectedIds: state.selectedIds,
      activeId: state.activeId,
      filter: state.filter,
      itemResults: state.itemResults,
      executionStatus: state.executionStatus,
      setFilter: state.setFilter,
      toggleSelectedIds: state.toggleSelectedIds,
      toggleSelectAll: state.toggleSelectAll,
      setActiveId: state.setActiveId,
    })),
  );

  const selectionLocked = executionStatus === "executing" || executionStatus === "stopping";
  const groupedEntries = useMemo(() => buildMaintenanceEntryGroups(entries, { itemResults }), [entries, itemResults]);

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
  const visibleIds = visibleEntries.flatMap((group) => group.items.map((entry) => entry.id));
  const isGroupFullySelected = (group: MaintenanceEntryGroup): boolean =>
    group.items.every((entry) => selectedIds.includes(entry.id));
  const isGroupPartiallySelected = (group: MaintenanceEntryGroup): boolean =>
    group.items.some((entry) => selectedIds.includes(entry.id)) && !isGroupFullySelected(group);
  const allVisibleSelected = visibleEntries.length > 0 && visibleEntries.every((group) => isGroupFullySelected(group));
  const someVisibleSelected = visibleEntries.some(
    (group) => isGroupPartiallySelected(group) || isGroupFullySelected(group),
  );
  const selectedVisibleCount = visibleEntries.filter((group) => isGroupFullySelected(group)).length;

  const items: MediaBrowserItem[] = sortedEntries.map((group) => {
    const representative = group.representative;
    const checkedState = isGroupFullySelected(group) ? true : isGroupPartiallySelected(group) ? "indeterminate" : false;

    return {
      id: group.id,
      active: group.items.some((entry) => activeId === entry.id),
      title: representative.fileInfo.number,
      subtitle: buildGroupSubtitle(group),
      errorText: group.errorText,
      status: group.status,
      selectionControl: (
        <Checkbox
          checked={checkedState}
          disabled={selectionLocked}
          onCheckedChange={() => {
            toggleSelectedIds(group.items.map((entry) => entry.id));
          }}
          onClick={(event) => event.stopPropagation()}
        />
      ),
      onClick: () => setActiveId(group.items.find((entry) => entry.id === activeId)?.id ?? representative.id),
      menuContent: buildMenuContent(group.items.find((entry) => entry.id === activeId) ?? representative),
    };
  });

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
            checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
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

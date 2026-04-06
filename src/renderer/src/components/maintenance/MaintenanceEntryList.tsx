import type { LocalScanEntry } from "@shared/types";
import { FileText, FolderOpen, FolderSearch, Play } from "lucide-react";
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
import { buildMaintenanceEntryViewModel, type MaintenanceEntryGroupViewModel } from "@/lib/maintenanceGrouping";
import { type MaintenanceFilter, useMaintenanceEntryStore } from "@/store/maintenanceEntryStore";
import { useMaintenanceExecutionStore } from "@/store/maintenanceExecutionStore";
import { useMaintenancePreviewStore } from "@/store/maintenancePreviewStore";
import { toggleMaintenanceSelectedIds } from "@/store/maintenanceSession";
import { playMediaPath } from "@/utils/playback";

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

function buildMenuContent(entry: LocalScanEntry) {
  const handleOpenFolder = () => {
    if (!window.electron?.openPath) {
      toast.info("打开目录功能仅在桌面客户端可用");
      return;
    }
    void window.electron.openPath(entry.currentDir);
  };

  const handlePlay = () => void playMediaPath(entry.fileInfo.filePath, "播放功能仅在桌面客户端可用");

  const handleOpenNfo = () => {
    window.dispatchEvent(
      new CustomEvent("app:open-nfo", { detail: { path: entry.nfoPath ?? entry.fileInfo.filePath } }),
    );
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
  const { entries, selectedIds, activeId, filter, setFilter, setActiveId } = useMaintenanceEntryStore(
    useShallow((state) => ({
      entries: state.entries,
      selectedIds: state.selectedIds,
      activeId: state.activeId,
      filter: state.filter,
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
  const selectionLocked = executionStatus === "executing" || executionStatus === "stopping";
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
  const selectedVisibleCount = visibleEntries.filter((group) => isGroupFullySelected(group)).length;

  const items: MediaBrowserItem[] = sortedEntries.map((group) => {
    const representative = group.representative;
    const checkedState = isGroupFullySelected(group) ? true : isGroupPartiallySelected(group) ? "indeterminate" : false;

    return {
      id: group.id,
      active: group.items.some((entry) => activeId === entry.fileId),
      title: representative.fileInfo.number,
      subtitle: buildGroupSubtitle(group),
      errorText: group.errorText,
      status: group.status,
      selectionControl: (
        <Checkbox
          checked={checkedState}
          disabled={selectionLocked}
          onCheckedChange={() => {
            toggleMaintenanceSelectedIds(group.items.map((entry) => entry.fileId));
          }}
          onClick={(event) => event.stopPropagation()}
        />
      ),
      onClick: () =>
        setActiveId(group.items.find((entry) => entry.fileId === activeId)?.fileId ?? representative.fileId),
      menuContent: buildMenuContent(group.items.find((entry) => entry.fileId === activeId) ?? representative),
    };
  });

  return (
    <MediaBrowserList
      items={items}
      filter={filter}
      onFilterChange={(nextFilter) => setFilter(nextFilter)}
      emptyContent={
        <div className="flex flex-col items-center justify-center gap-3 py-16 select-none animate-in fade-in duration-500">
          <FolderSearch className="h-12 w-12 text-muted-foreground/20" strokeWidth={1} />
          <span className="text-[13px] text-muted-foreground/40 tracking-wider">无维护项目</span>
        </div>
      }
      headerLeading={
        <>
          <Checkbox
            id="maintenance-select-all"
            checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
            disabled={selectionLocked || visibleIds.length === 0}
            onCheckedChange={() => {
              toggleMaintenanceSelectedIds(visibleIds);
            }}
          />
          <label htmlFor="maintenance-select-all" className="cursor-pointer">
            全选 ({selectedVisibleCount}/{visibleEntries.length})
          </label>
        </>
      }
    />
  );
}

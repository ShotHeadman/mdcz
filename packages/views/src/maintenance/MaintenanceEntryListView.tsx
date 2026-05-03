import { Checkbox } from "@mdcz/ui";
import { FolderSearch } from "lucide-react";
import type { ReactNode } from "react";
import { type MediaBrowserFilter, type MediaBrowserItemStatus, MediaBrowserList } from "../common";

export interface MaintenanceEntryListViewItem {
  active: boolean;
  errorText?: string;
  id: string;
  menuContent: ReactNode;
  onClick: () => void;
  onSelectionChange?: () => void;
  selected?: boolean | "indeterminate";
  selectionDisabled?: boolean;
  status?: MediaBrowserItemStatus;
  subtitle?: string;
  title: string;
}

export interface MaintenanceEntryListViewStat {
  label: string;
  tone?: "default" | "positive" | "negative";
  value: string;
}

export interface MaintenanceEntryListViewProps {
  allVisibleSelected: boolean;
  filter: MediaBrowserFilter;
  items: MaintenanceEntryListViewItem[];
  onFilterChange: (filter: MediaBrowserFilter) => void;
  onToggleVisibleSelection: () => void;
  selectedVisibleCount: number;
  selectionDisabled?: boolean;
  showSelection?: boolean;
  someVisibleSelected: boolean;
  stats: MaintenanceEntryListViewStat[];
  visibleCount: number;
  visibleIdsCount: number;
}

export function MaintenanceEntryListView({
  allVisibleSelected,
  filter,
  items,
  onFilterChange,
  onToggleVisibleSelection,
  selectedVisibleCount,
  selectionDisabled = false,
  showSelection = false,
  someVisibleSelected,
  stats,
  visibleCount,
  visibleIdsCount,
}: MaintenanceEntryListViewProps) {
  return (
    <MediaBrowserList
      items={items.map((item) => ({
        id: item.id,
        active: item.active,
        title: item.title,
        subtitle: item.subtitle,
        errorText: item.errorText,
        status: item.status,
        menuContent: item.menuContent,
        onClick: item.onClick,
        selectionControl:
          showSelection && item.onSelectionChange ? (
            <Checkbox
              checked={item.selected ?? false}
              disabled={item.selectionDisabled}
              onCheckedChange={item.onSelectionChange}
              onClick={(event) => event.stopPropagation()}
            />
          ) : undefined,
      }))}
      filter={filter}
      onFilterChange={onFilterChange}
      stats={stats}
      emptyContent={
        <div className="flex flex-col items-center justify-center gap-3 py-16 select-none animate-in fade-in duration-500">
          <FolderSearch className="h-12 w-12 text-muted-foreground/20" strokeWidth={1} />
          <span className="text-[13px] text-muted-foreground/40 tracking-wider">无维护项目</span>
        </div>
      }
      headerLeading={
        showSelection ? (
          <>
            <Checkbox
              id="maintenance-select-all"
              checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
              disabled={selectionDisabled || visibleIdsCount === 0}
              onCheckedChange={onToggleVisibleSelection}
            />
            <label htmlFor="maintenance-select-all" className="cursor-pointer">
              全选 ({selectedVisibleCount}/{visibleCount})
            </label>
          </>
        ) : undefined
      }
    />
  );
}

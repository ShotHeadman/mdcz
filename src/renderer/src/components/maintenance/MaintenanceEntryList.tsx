import type { LocalScanEntry, MaintenanceItemResult } from "@shared/types";
import { CheckCircle2, FileText, FolderOpen, Play, XCircle } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/ContextMenu";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { TreeButton } from "@/components/ui/TreeButton";
import { cn } from "@/lib/utils";
import { type MaintenanceFilter, useMaintenanceStore } from "@/store/maintenanceStore";

const FILTER_OPTIONS: Array<{ id: MaintenanceFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "success", label: "成功" },
  { id: "failed", label: "失败" },
];

const getTitle = (entry: LocalScanEntry) =>
  entry.crawlerData?.title_zh ?? entry.crawlerData?.title ?? entry.fileInfo.fileName;

const statusWeight = (result?: MaintenanceItemResult): number => {
  if (!result) return 3;
  if (result.status === "success") return 0;
  if (result.status === "failed") return 1;
  if (result.status === "processing") return 2;
  return 3;
};

const matchesFilter = (filter: MaintenanceFilter, result?: MaintenanceItemResult): boolean => {
  if (filter === "all") return true;
  return result?.status === filter;
};

function EntryItem({
  entry,
  result,
  selected,
  active,
  selectionLocked,
}: {
  entry: LocalScanEntry;
  result?: MaintenanceItemResult;
  selected: boolean;
  active: boolean;
  selectionLocked: boolean;
}) {
  const setActiveId = useMaintenanceStore((state) => state.setActiveId);
  const toggleSelected = useMaintenanceStore((state) => state.toggleSelected);

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
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <TreeButton
          isSelected={active}
          className="group flex-col items-start p-0 hover:bg-transparent"
          onClick={() => setActiveId(entry.id)}
        >
          <div
            className={cn(
              "flex w-full items-center gap-3 rounded-xl border px-3 py-3 transition-all",
              active ? "border-primary/60 bg-primary/5" : "border-transparent hover:border-border hover:bg-muted/30",
            )}
          >
            <Checkbox
              checked={selected}
              disabled={selectionLocked}
              onCheckedChange={() => toggleSelected(entry.id)}
              onClick={(event) => event.stopPropagation()}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{entry.fileInfo.number}</span>
                <span className="truncate text-sm text-muted-foreground">{getTitle(entry)}</span>
              </div>
              {result?.error && <div className="mt-1 truncate text-xs text-destructive">{result.error}</div>}
            </div>
            {result?.status === "success" && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />}
            {result?.status === "failed" && <XCircle className="h-4 w-4 shrink-0 text-destructive" />}
          </div>
        </TreeButton>
      </ContextMenuTrigger>
      <ContextMenuContent>
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
      </ContextMenuContent>
    </ContextMenu>
  );
}

export default function MaintenanceEntryList() {
  const { entries, selectedIds, activeId, filter, itemResults, executionStatus, setFilter, toggleSelectAll } =
    useMaintenanceStore((state) => ({
      entries: state.entries,
      selectedIds: state.selectedIds,
      activeId: state.activeId,
      filter: state.filter,
      itemResults: state.itemResults,
      executionStatus: state.executionStatus,
      setFilter: state.setFilter,
      toggleSelectAll: state.toggleSelectAll,
    }));

  const selectionLocked = executionStatus === "executing" || executionStatus === "stopping";

  const visibleEntries = useMemo(
    () =>
      [...entries]
        .filter((entry) => matchesFilter(filter, itemResults[entry.id]))
        .sort((left, right) => {
          const weightDiff = statusWeight(itemResults[left.id]) - statusWeight(itemResults[right.id]);
          if (weightDiff !== 0) return weightDiff;
          return left.fileInfo.number.localeCompare(right.fileInfo.number);
        }),
    [entries, filter, itemResults],
  );

  const visibleIds = visibleEntries.map((entry) => entry.id);
  const selectedVisibleCount = visibleIds.filter((id) => selectedIds.includes(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));

  return (
    <Card className="flex h-full flex-col gap-2 border-0 bg-transparent pt-4 shadow-none rounded-none">
      <CardHeader className="border-b shrink-0 pb-3! px-4">
        <CardTitle className="space-y-3 text-sm font-bold tracking-tight">
          <div className="flex items-center justify-between gap-2">
            <span>维护项目</span>
            <span className="text-xs font-medium text-muted-foreground">{entries.length} 项</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                id="maintenance-select-all"
                checked={allVisibleSelected}
                disabled={selectionLocked || visibleIds.length === 0}
                onCheckedChange={() => toggleSelectAll(visibleIds)}
              />
              <label htmlFor="maintenance-select-all" className="cursor-pointer">
                全选 ({selectedVisibleCount}/{visibleEntries.length})
              </label>
            </div>
            <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-1">
              {FILTER_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs transition-colors",
                    filter === option.id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setFilter(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 overflow-hidden p-0">
        <ScrollArea className="h-full">
          <div className="space-y-2 p-3">
            {visibleEntries.length === 0 && (
              <div className="flex min-h-40 items-center justify-center text-center text-xs text-muted-foreground opacity-70">
                扫描完成后，维护项目会显示在这里。
              </div>
            )}

            {visibleEntries.map((entry) => (
              <EntryItem
                key={entry.id}
                entry={entry}
                result={itemResults[entry.id]}
                selected={selectedIds.includes(entry.id)}
                active={activeId === entry.id}
                selectionLocked={selectionLocked}
              />
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

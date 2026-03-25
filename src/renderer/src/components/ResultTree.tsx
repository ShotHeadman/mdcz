import { Copy, FileText, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { deleteFile, deleteFileAndFolder, requeueScrapeByNumber, requeueScrapeByUrl } from "@/api/manual";
import { type MediaBrowserFilter, MediaBrowserList } from "@/components/shared/MediaBrowserList";
import { Button } from "@/components/ui/Button";
import { ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut } from "@/components/ui/ContextMenu";
import {
  buildScrapeResultGroupActionContext,
  buildScrapeResultGroups,
  type ScrapeResultGroup,
} from "@/lib/scrapeResultGrouping";
import { useScrapeStore } from "@/store/scrapeStore";
import { useUIStore } from "@/store/uiStore";
import { getDirFromPath } from "@/utils/path";

function getFileNameFromPath(filePath: string) {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return slash >= 0 ? filePath.slice(slash + 1) : filePath;
}

function buildMenuContent(group: ScrapeResultGroup, selectedResultId: string | null) {
  const actionContext = buildScrapeResultGroupActionContext(group, selectedResultId);
  const result = actionContext.selectedItem;
  const nfoPath = actionContext.nfoPath ?? result.path;
  const groupedVideoPaths = actionContext.videoPaths;

  const handleCopyNumber = async () => {
    if (!result.number) {
      toast.error("Number is empty");
      return;
    }
    try {
      await navigator.clipboard.writeText(result.number);
      toast.success("Number copied");
    } catch {
      toast.error("Failed to copy number");
    }
  };

  const handleRescrapeByNumber = async () => {
    const defaultNumber = result.number || "";
    const number = window.prompt("输入番号重新刮削", defaultNumber)?.trim();
    if (!number) return;
    try {
      const response = await requeueScrapeByNumber(groupedVideoPaths, number);
      toast.success(response.data?.message ?? "Queued re-scrape by number");
    } catch {
      toast.error("Failed to queue re-scrape by number");
    }
  };

  const handleRescrapeByUrl = async () => {
    const url = window.prompt("输入网址重新刮削", "")?.trim();
    if (!url) return;
    try {
      const response = await requeueScrapeByUrl(groupedVideoPaths, url);
      toast.success(response.data?.message ?? "Queued re-scrape by URL");
    } catch {
      toast.error("Failed to queue re-scrape by URL");
    }
  };

  const handleDeleteFile = async () => {
    if (
      !window.confirm(
        groupedVideoPaths.length > 1
          ? `确定删除当前分组下的 ${groupedVideoPaths.length} 个文件吗？\n${result.number}`
          : `确定删除文件吗？\n${result.path}`,
      )
    ) {
      return;
    }
    try {
      await deleteFile(groupedVideoPaths);
      toast.success(groupedVideoPaths.length > 1 ? `Deleted ${groupedVideoPaths.length} files` : "File deleted");
    } catch {
      toast.error("Failed to delete file");
    }
  };

  const handleDeleteFolder = async () => {
    if (!window.confirm(`确定删除文件和所在文件夹吗？\n${result.path}`)) return;
    try {
      await deleteFileAndFolder(result.path);
      toast.success("Folder deleted");
    } catch {
      toast.error("Failed to delete folder");
    }
  };

  const handleOpenFolder = () => {
    if (window.electron?.openPath) {
      window.electron.openPath(getDirFromPath(result.path));
    } else {
      toast.info("Open folder is only available in desktop mode");
    }
  };

  const handlePlay = () => {
    if (window.electron?.openPath) {
      window.electron.openPath(result.path);
    } else {
      toast.info("Play is only available in desktop mode");
    }
  };

  const handleOpenNfo = () => {
    window.dispatchEvent(new CustomEvent("app:open-nfo", { detail: { path: nfoPath } }));
  };

  return (
    <>
      <ContextMenuItem onClick={handleCopyNumber}>
        Copy number
        <ContextMenuShortcut>
          <Copy className="h-3.5 w-3.5" />
        </ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={handleRescrapeByNumber}>
        Re-scrape by number
        <ContextMenuShortcut>N</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onClick={handleRescrapeByUrl}>
        Re-scrape by URL
        <ContextMenuShortcut>U</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={handleDeleteFile} className="text-destructive focus:text-destructive">
        Delete file
        <ContextMenuShortcut>D</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onClick={handleDeleteFolder} className="text-destructive focus:text-destructive">
        Delete file and folder
        <ContextMenuShortcut>A</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={handleOpenFolder}>
        Open folder
        <ContextMenuShortcut>F</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onClick={handleOpenNfo}>
        Edit NFO
        <ContextMenuShortcut>
          <FileText className="h-3.5 w-3.5" />
        </ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onClick={handlePlay}>
        Play
        <ContextMenuShortcut>P</ContextMenuShortcut>
      </ContextMenuItem>
    </>
  );
}

export function ResultTree() {
  const { results, clearResults } = useScrapeStore();
  const { selectedResultId, setSelectedResultId } = useUIStore();
  const [filter, setFilter] = useState<MediaBrowserFilter>("all");
  const resultGroups = useMemo(() => buildScrapeResultGroups(results), [results]);

  const items = useMemo(
    () =>
      resultGroups.map((group) => ({
        id: group.id,
        active: group.items.some((item) => item.id === selectedResultId),
        title: group.display.number || "Unknown",
        subtitle: group.display.title || getFileNameFromPath(group.display.path),
        errorText: group.display.errorMessage,
        status: group.display.status,
        onClick: () =>
          setSelectedResultId(group.items.find((item) => item.id === selectedResultId)?.id ?? group.representative.id),
        menuContent: buildMenuContent(group, selectedResultId),
      })),
    [resultGroups, selectedResultId, setSelectedResultId],
  );

  return (
    <MediaBrowserList
      items={items}
      filter={filter}
      onFilterChange={setFilter}
      emptyMessage="暂无结果。启动刮削任务后，处理项将显示在此处。"
      headerTrailing={
        resultGroups.length > 0 ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 hover:text-destructive"
            onClick={clearResults}
            title="清空结果"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : undefined
      }
    />
  );
}

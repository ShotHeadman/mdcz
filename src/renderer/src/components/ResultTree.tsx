import { toErrorMessage } from "@shared/error";
import { Copy, FileText, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { deleteFile, deleteFileAndFolder, retryScrapeSelection } from "@/api/manual";
import { getScrapeResultTitle } from "@/components/detail/detailViewAdapters";
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
import { playMediaPath } from "@/utils/playback";

function getFileNameFromPath(filePath: string) {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return slash >= 0 ? filePath.slice(slash + 1) : filePath;
}

function buildMenuContent(
  group: ScrapeResultGroup,
  selectedResultId: string | null,
  scrapeStatus: "idle" | "running" | "stopping" | "paused",
) {
  const actionContext = buildScrapeResultGroupActionContext(group, selectedResultId);
  const result = actionContext.selectedItem;
  const resultPath = result.fileInfo.filePath;
  const resultNumber = result.fileInfo.number;
  const nfoPath = actionContext.nfoPath ?? resultPath;
  const groupedVideoPaths = actionContext.videoPaths;

  const handleCopyNumber = async () => {
    if (!resultNumber) {
      toast.error("Number is empty");
      return;
    }
    try {
      await navigator.clipboard.writeText(resultNumber);
      toast.success("Number copied");
    } catch {
      toast.error("Failed to copy number");
    }
  };

  const handleRetryScrape = async () => {
    try {
      const response = await retryScrapeSelection(groupedVideoPaths, {
        scrapeStatus,
        canRequeueCurrentRun: group.status === "failed",
      });
      if (response.data.strategy === "new-task") {
        const scrapeStore = useScrapeStore.getState();
        scrapeStore.clearResults();
        scrapeStore.updateProgress(0, 0);
        scrapeStore.setScraping(true);
        scrapeStore.setScrapeStatus("running");
        useUIStore.getState().setSelectedResultId(null);
      }
      toast.success(response.data.message);
    } catch (error) {
      toast.error(toErrorMessage(error, "重新刮削失败"));
    }
  };

  const handleDeleteFile = async () => {
    if (
      !window.confirm(
        groupedVideoPaths.length > 1
          ? `确定删除当前分组下的 ${groupedVideoPaths.length} 个文件吗？\n${resultNumber}`
          : `确定删除文件吗？\n${resultPath}`,
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
    if (!window.confirm(`确定删除文件和所在文件夹吗？\n${resultPath}`)) return;
    try {
      await deleteFileAndFolder(resultPath);
      toast.success("Folder deleted");
    } catch {
      toast.error("Failed to delete folder");
    }
  };

  const handleOpenFolder = () => {
    if (window.electron?.openPath) {
      window.electron.openPath(getDirFromPath(resultPath));
    } else {
      toast.info("Open folder is only available in desktop mode");
    }
  };

  const handlePlay = () => void playMediaPath(resultPath, "Play is only available in desktop mode", "Play failed");

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
      <ContextMenuItem onClick={handleRetryScrape}>Re-scrape</ContextMenuItem>
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
  const { results, clearResults, scrapeStatus } = useScrapeStore();
  const { selectedResultId, setSelectedResultId } = useUIStore();
  const [filter, setFilter] = useState<MediaBrowserFilter>("all");
  const resultGroups = useMemo(() => buildScrapeResultGroups(results), [results]);

  const items = useMemo(
    () =>
      resultGroups.map((group) => ({
        id: group.id,
        active: group.items.some((item) => item.fileId === selectedResultId),
        title: group.display.fileInfo.number || "Unknown",
        subtitle: getScrapeResultTitle(group.display) || getFileNameFromPath(group.display.fileInfo.filePath),
        errorText: group.errorText ?? group.display.error,
        status: group.status,
        onClick: () =>
          setSelectedResultId(
            group.items.find((item) => item.fileId === selectedResultId)?.fileId ?? group.representative.fileId,
          ),
        menuContent: buildMenuContent(group, selectedResultId, scrapeStatus),
      })),
    [resultGroups, scrapeStatus, selectedResultId, setSelectedResultId],
  );

  return (
    <MediaBrowserList
      items={items}
      filter={filter}
      onFilterChange={setFilter}
      emptyContent={
        <div className="flex flex-col items-center justify-center gap-3 py-16 select-none animate-in fade-in duration-500">
          <Search className="h-12 w-12 text-muted-foreground/20" strokeWidth={1} />
          <span className="text-[13px] text-muted-foreground/40 tracking-wider">暂无结果</span>
        </div>
      }
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

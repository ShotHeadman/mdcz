import { toErrorMessage } from "@mdcz/shared/error";
import { validateManualScrapeUrl } from "@mdcz/shared/manualScrapeUrl";
import { Copy, FileText, Link2, Search, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { deleteFile, deleteFileAndFolder, retryScrapeSelection } from "@/api/manual";
import { ipc } from "@/client/ipc";
import { getScrapeResultTitle } from "@/components/detail/detailViewAdapters";
import { type MediaBrowserFilter, MediaBrowserList } from "@/components/shared/MediaBrowserList";
import { Button } from "@/components/ui/Button";
import { ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut } from "@/components/ui/ContextMenu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import {
  buildScrapeResultGroupActionContext,
  buildScrapeResultGroups,
  type ScrapeResultGroup,
} from "@/lib/scrapeResultGrouping";
import { useScrapeStore } from "@/store/scrapeStore";
import { useUIStore } from "@/store/uiStore";
import { playMediaPath } from "@/utils/playback";

function getFileNameFromPath(filePath: string) {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return slash >= 0 ? filePath.slice(slash + 1) : filePath;
}

interface ManualUrlRescrapeTarget {
  videoPaths: string[];
  number: string;
  canRequeueCurrentRun: boolean;
}

const activateNewScrapeTask = () => {
  const scrapeStore = useScrapeStore.getState();
  scrapeStore.clearResults();
  scrapeStore.updateProgress(0, 0);
  scrapeStore.setScraping(true);
  scrapeStore.setScrapeStatus("running");
  useUIStore.getState().setSelectedResultId(null);
};

function buildMenuContent(
  group: ScrapeResultGroup,
  selectedResultId: string | null,
  scrapeStatus: "idle" | "running" | "stopping" | "paused",
  onManualUrlRescrape: (target: ManualUrlRescrapeTarget) => void,
) {
  const actionContext = buildScrapeResultGroupActionContext(group, selectedResultId);
  const result = actionContext.selectedItem;
  const resultPath = result.fileInfo.filePath;
  const resultNumber = result.fileInfo.number;
  const nfoPath = actionContext.nfoPath ?? resultPath;
  const groupedVideoPaths = actionContext.videoPaths;

  const handleCopyNumber = async () => {
    if (!resultNumber) {
      toast.error("番号为空");
      return;
    }
    try {
      await navigator.clipboard.writeText(resultNumber);
      toast.success("已复制番号");
    } catch {
      toast.error("复制番号失败");
    }
  };

  const handleRetryScrape = async () => {
    try {
      const response = await retryScrapeSelection(groupedVideoPaths, {
        scrapeStatus,
        canRequeueCurrentRun: group.status === "failed",
      });
      if (response.data.strategy === "new-task") {
        activateNewScrapeTask();
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
      toast.success(groupedVideoPaths.length > 1 ? `已删除 ${groupedVideoPaths.length} 个文件` : "已删除文件");
    } catch {
      toast.error("删除文件失败");
    }
  };

  const handleDeleteFolder = async () => {
    if (!window.confirm(`确定删除文件和所在文件夹吗？\n${resultPath}`)) return;
    try {
      await deleteFileAndFolder(resultPath);
      toast.success("已删除文件夹");
    } catch {
      toast.error("删除文件夹失败");
    }
  };

  const handleOpenFolder = async () => {
    const filePath = resultPath.trim();
    if (!filePath) {
      toast.info("无可打开的文件路径");
      return;
    }

    try {
      await ipc.app.showItemInFolder(filePath);
    } catch (error) {
      toast.error(`打开目录失败: ${toErrorMessage(error)}`);
    }
  };

  const handlePlay = () => void playMediaPath(resultPath, "播放功能仅在桌面客户端可用", "播放失败");

  const handleOpenNfo = () => {
    window.dispatchEvent(new CustomEvent("app:open-nfo", { detail: { path: nfoPath } }));
  };

  const handleManualUrlRescrape = () => {
    onManualUrlRescrape({
      videoPaths: groupedVideoPaths,
      number: resultNumber || "未识别番号",
      canRequeueCurrentRun: group.status === "failed",
    });
  };

  return (
    <>
      <ContextMenuItem onClick={handleCopyNumber}>
        复制番号
        <ContextMenuShortcut>
          <Copy className="h-3.5 w-3.5" />
        </ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={handleRetryScrape}>重新刮削</ContextMenuItem>
      <ContextMenuItem onClick={handleManualUrlRescrape}>
        按 URL 重新刮削
        <ContextMenuShortcut>
          <Link2 className="h-3.5 w-3.5" />
        </ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={handleDeleteFile} className="text-destructive focus:text-destructive">
        删除文件
        <ContextMenuShortcut>D</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onClick={handleDeleteFolder} className="text-destructive focus:text-destructive">
        删除文件及所在文件夹
        <ContextMenuShortcut>A</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={handleOpenFolder}>
        打开目录
        <ContextMenuShortcut>F</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onClick={handleOpenNfo}>
        编辑 NFO
        <ContextMenuShortcut>
          <FileText className="h-3.5 w-3.5" />
        </ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onClick={handlePlay}>
        播放
        <ContextMenuShortcut>P</ContextMenuShortcut>
      </ContextMenuItem>
    </>
  );
}

function ManualUrlRescrapeDialog({
  target,
  scrapeStatus,
  onOpenChange,
}: {
  target: ManualUrlRescrapeTarget | null;
  scrapeStatus: "idle" | "running" | "stopping" | "paused";
  onOpenChange: (open: boolean) => void;
}) {
  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const validation = useMemo(() => validateManualScrapeUrl(url), [url]);
  const errorText = touched && !validation.valid ? validation.message : undefined;

  useEffect(() => {
    if (target) {
      setUrl("");
      setTouched(false);
      setSubmitting(false);
    }
  }, [target]);

  const handleOpenChange = (open: boolean) => {
    if (!open && !submitting) {
      onOpenChange(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (!target || !validation.valid) {
      return;
    }

    setSubmitting(true);
    try {
      const response = await retryScrapeSelection(target.videoPaths, {
        scrapeStatus,
        canRequeueCurrentRun: target.canRequeueCurrentRun,
        manualUrl: validation.route.url,
      });
      if (response.data.strategy === "new-task") {
        activateNewScrapeTask();
      }
      toast.success(response.data.message);
      onOpenChange(false);
    } catch (error) {
      toast.error(toErrorMessage(error, "按 URL 重新刮削失败"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>按 URL 重新刮削</DialogTitle>
            <DialogDescription>当前番号：{target?.number ?? ""}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Input
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                if (touched) {
                  setTouched(false);
                }
              }}
              onBlur={() => setTouched(true)}
              placeholder="https://www.dmm.co.jp/"
              aria-invalid={Boolean(errorText)}
              disabled={submitting}
              autoFocus
            />
            {errorText ? <p className="text-sm text-destructive">{errorText}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "提交中..." : "重新刮削"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ResultTree() {
  const { results, clearResults, scrapeStatus } = useScrapeStore();
  const { selectedResultId, setSelectedResultId } = useUIStore();
  const [filter, setFilter] = useState<MediaBrowserFilter>("all");
  const [manualUrlTarget, setManualUrlTarget] = useState<ManualUrlRescrapeTarget | null>(null);
  const resultGroups = useMemo(() => buildScrapeResultGroups(results), [results]);
  const successCount = useMemo(() => resultGroups.filter((group) => group.status === "success").length, [resultGroups]);
  const failedCount = useMemo(() => resultGroups.filter((group) => group.status === "failed").length, [resultGroups]);

  const items = useMemo(
    () =>
      resultGroups.map((group) => ({
        id: group.id,
        active: group.items.some((item) => item.fileId === selectedResultId),
        title: group.display.fileInfo.number || "未识别番号",
        subtitle: getScrapeResultTitle(group.display) || getFileNameFromPath(group.display.fileInfo.filePath),
        errorText: group.errorText ?? group.display.error,
        status: group.status,
        onClick: () =>
          setSelectedResultId(
            group.items.find((item) => item.fileId === selectedResultId)?.fileId ?? group.representative.fileId,
          ),
        menuContent: buildMenuContent(group, selectedResultId, scrapeStatus, setManualUrlTarget),
      })),
    [resultGroups, scrapeStatus, selectedResultId, setSelectedResultId],
  );

  return (
    <>
      <MediaBrowserList
        items={items}
        filter={filter}
        onFilterChange={setFilter}
        title="处理队列"
        stats={[
          { label: "总计", value: String(resultGroups.length) },
          { label: "成功", value: String(successCount), tone: "positive" },
          { label: "失败", value: String(failedCount), tone: "negative" },
        ]}
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
      <ManualUrlRescrapeDialog
        target={manualUrlTarget}
        scrapeStatus={scrapeStatus}
        onOpenChange={(open) => {
          if (!open) {
            setManualUrlTarget(null);
          }
        }}
      />
    </>
  );
}

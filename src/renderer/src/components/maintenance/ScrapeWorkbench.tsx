import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, FileText, FolderOpen, Play, RotateCcw, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ipc } from "@/client/ipc";
import { DetailPanel } from "@/components/DetailPanel";
import { ResultTree } from "@/components/ResultTree";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Progress } from "@/components/ui/Progress";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/Resizable";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { type ScrapeResult, useScrapeStore } from "@/store/scrapeStore";
import { useUIStore } from "@/store/uiStore";

export default function ScrapeWorkbench() {
  const navigate = useNavigate();
  const { isScraping, progress, currentFilePath, statusText, results, clearResults, failedCount } = useScrapeStore();
  const { selectedResultId } = useUIStore();

  const [failDialogOpen, setFailDialogOpen] = useState(false);
  const [selectedFailedPaths, setSelectedFailedPaths] = useState<Set<string>>(new Set());

  const failedResults = useMemo(() => results.filter((r) => r.status === "failed"), [results]);
  const selectedItem = results.find((r) => r.id === selectedResultId);

  const handlePlay = () => {
    if (!selectedItem?.path) {
      toast.info("请先选择一个项目");
      return;
    }
    if (window.electron?.openPath) {
      window.electron.openPath(selectedItem.path);
      return;
    }
    toast.info("播放功能仅在桌面客户端可用");
  };

  const handleOpenFolder = () => {
    if (!selectedItem?.path) {
      toast.info("请先选择一个项目");
      return;
    }
    if (window.electron?.openPath) {
      const slash = Math.max(selectedItem.path.lastIndexOf("/"), selectedItem.path.lastIndexOf("\\"));
      const dir = slash > 0 ? selectedItem.path.slice(0, slash) : selectedItem.path;
      window.electron.openPath(dir);
      return;
    }
    toast.info("打开文件夹功能仅在桌面客户端可用");
  };

  const handleEditNfo = () => {
    if (!selectedItem?.path) {
      toast.info("请先选择一个项目");
      return;
    }
    window.dispatchEvent(
      new CustomEvent("app:open-nfo", {
        detail: { path: selectedItem.path },
      }),
    );
  };

  const handleRetrySingle = async (item: ScrapeResult) => {
    try {
      const result = await ipc.scraper.retryFailed([item.path]);
      toast.success(`重试任务已启动，共 ${result.totalFiles} 个文件`);
      setFailDialogOpen(false);
    } catch (_error) {
      toast.error("重试失败");
    }
  };

  const handleRetrySelected = async () => {
    const paths = Array.from(selectedFailedPaths);
    if (paths.length === 0) {
      toast.info("请先选择要重试的项目");
      return;
    }
    try {
      const result = await ipc.scraper.retryFailed(paths);
      toast.success(`重试任务已启动，共 ${result.totalFiles} 个文件`);
      setSelectedFailedPaths(new Set());
      setFailDialogOpen(false);
    } catch (_error) {
      toast.error("批量重试失败");
    }
  };

  const handleRetryAll = async () => {
    const paths = failedResults.map((r) => r.path);
    if (paths.length === 0) return;
    try {
      const result = await ipc.scraper.retryFailed(paths);
      toast.success(`重试任务已启动，共 ${result.totalFiles} 个文件`);
      setFailDialogOpen(false);
    } catch (_error) {
      toast.error("全部重试失败");
    }
  };

  const toggleFailedSelection = (path: string) => {
    setSelectedFailedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedFailedPaths.size === failedResults.length) {
      setSelectedFailedPaths(new Set());
    } else {
      setSelectedFailedPaths(new Set(failedResults.map((r) => r.path)));
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-8 pb-2 border-b bg-background/60 backdrop-blur-md h-11 flex items-center">
        <div className="flex items-center gap-2 flex-1">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-lg h-9 px-4 gap-2 text-muted-foreground hover:text-foreground"
            onClick={clearResults}
          >
            <RotateCcw className="h-4 w-4" />
            清空列表
          </Button>
          <div className="h-4 w-px bg-border mx-1" />
          <Button
            variant="ghost"
            size="sm"
            className="rounded-lg h-9 px-4 gap-2 text-muted-foreground hover:text-foreground disabled:opacity-30"
            onClick={handleOpenFolder}
            disabled={!selectedItem}
          >
            <FolderOpen className="h-4 w-4" />
            打开目录
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="rounded-lg h-9 px-4 gap-2 text-muted-foreground hover:text-foreground disabled:opacity-30"
            onClick={handlePlay}
            disabled={!selectedItem}
          >
            <Play className="h-4 w-4" />
            播放
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="rounded-lg h-9 px-4 gap-2 text-muted-foreground hover:text-foreground disabled:opacity-30"
            onClick={handleEditNfo}
            disabled={!selectedItem}
          >
            <FileText className="h-4 w-4" />
            编辑 NFO
          </Button>
          {failedCount > 0 && !isScraping && (
            <>
              <div className="h-4 w-px bg-border mx-1" />
              <Button
                variant="ghost"
                size="sm"
                className="rounded-lg h-9 px-4 gap-2 text-destructive hover:text-destructive hover:bg-destructive/10 whitespace-nowrap"
                onClick={() => setFailDialogOpen(true)}
              >
                <AlertTriangle className="h-4 w-4" />
                失败处理
                <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                  {failedCount}
                </Badge>
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {isScraping && (
          <div className="px-8 pt-4 pb-0">
            <div className="bg-card rounded-lg p-1 border flex items-center gap-4">
              <Progress value={progress} className="h-2 flex-1 ml-3" />
              <span className="text-[10px] font-bold text-primary w-12 tabular-nums">{Math.round(progress)}%</span>
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 flex p-4">
          <ResizablePanelGroup orientation="horizontal" className="flex-1">
            <ResizablePanel
              id="result-list"
              defaultSize={36}
              minSize={20}
              className="flex flex-col bg-card rounded-xl border shadow-sm overflow-hidden"
            >
              <ResultTree />
            </ResizablePanel>

            <ResizableHandle className="w-1 bg-transparent hover:bg-primary/10 rounded-full" />

            <ResizablePanel
              id="detail-view"
              defaultSize={64}
              minSize={30}
              className="flex flex-col bg-card rounded-xl border shadow-sm overflow-hidden"
            >
              <DetailPanel />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>

      <div className="flex items-center justify-between px-8 py-3 border-t text-xs font-medium text-muted-foreground bg-background">
        <div className="flex items-center gap-4 truncate max-w-[70%]">
          {isScraping && (
            <div className="flex items-center gap-2 text-primary animate-pulse">
              <div className="h-1.5 w-1.5 rounded-full bg-current" />
              正在处理
            </div>
          )}
          <span className="truncate opacity-70 text-xs">{currentFilePath || "就绪"}</span>
        </div>
        {statusText && <span className="px-2 py-0.5 bg-muted rounded text-xs shrink-0">{statusText}</span>}
      </div>

      <Dialog open={failDialogOpen} onOpenChange={setFailDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              失败处理
              <Badge variant="destructive">{failedResults.length} 项失败</Badge>
            </DialogTitle>
            <DialogDescription>选择需要重试的项目，或全部重试。重试将以新任务启动。</DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between py-2 border-b">
            <div className="flex items-center gap-2">
              <Checkbox
                id="select-all-failed"
                checked={selectedFailedPaths.size === failedResults.length && failedResults.length > 0}
                onCheckedChange={toggleSelectAll}
              />
              <label htmlFor="select-all-failed" className="text-sm cursor-pointer">
                全选 ({selectedFailedPaths.size}/{failedResults.length})
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                disabled={selectedFailedPaths.size === 0}
                onClick={handleRetrySelected}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                重试选中 ({selectedFailedPaths.size})
              </Button>
              <Button variant="default" size="sm" className="h-8 gap-1.5" onClick={handleRetryAll}>
                <RotateCcw className="h-3.5 w-3.5" />
                全部重试
              </Button>
            </div>
          </div>

          <ScrollArea className="flex-1 min-h-0 -mx-6 px-6">
            <div className="space-y-1 py-2">
              {failedResults.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors group"
                >
                  <Checkbox
                    checked={selectedFailedPaths.has(item.path)}
                    onCheckedChange={() => toggleFailedSelection(item.path)}
                  />
                  <XCircle className="h-4 w-4 text-destructive shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{item.number}</span>
                      {item.title && <span className="text-xs text-muted-foreground truncate">{item.title}</span>}
                    </div>
                    {item.error_msg && <p className="text-xs text-destructive mt-0.5 truncate">{item.error_msg}</p>}
                    <p className="text-[10px] text-muted-foreground truncate mt-0.5">{item.path}</p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRetrySingle(item)}>
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          <DialogFooter className="border-t pt-4">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                setFailDialogOpen(false);
                navigate({ to: "/logs" });
              }}
            >
              <FileText className="h-3.5 w-3.5" />
              查看日志详情
            </Button>
            <DialogClose asChild>
              <Button variant="outline">关闭</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

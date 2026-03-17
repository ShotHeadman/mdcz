import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, FileText, RotateCcw, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ipc } from "@/client/ipc";
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
import { ScrollArea } from "@/components/ui/ScrollArea";
import { type ScrapeResult, useScrapeStore } from "@/store/scrapeStore";

interface ScrapeFailureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ScrapeFailureDialog({ open, onOpenChange }: ScrapeFailureDialogProps) {
  const navigate = useNavigate();
  const results = useScrapeStore((state) => state.results);
  const [selectedFailedPaths, setSelectedFailedPaths] = useState<Set<string>>(new Set());

  const failedResults = useMemo(() => results.filter((result) => result.status === "failed"), [results]);

  useEffect(() => {
    if (!open) {
      setSelectedFailedPaths(new Set());
      return;
    }

    setSelectedFailedPaths((prev) => {
      const validPaths = new Set(failedResults.map((result) => result.path));
      return new Set([...prev].filter((path) => validPaths.has(path)));
    });
  }, [failedResults, open]);

  const handleRetrySingle = async (item: ScrapeResult) => {
    try {
      const result = await ipc.scraper.retryFailed([item.path]);
      toast.success(`重试任务已启动，共 ${result.totalFiles} 个文件`);
      onOpenChange(false);
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
      onOpenChange(false);
    } catch (_error) {
      toast.error("批量重试失败");
    }
  };

  const handleRetryAll = async () => {
    const paths = failedResults.map((result) => result.path);
    if (paths.length === 0) {
      return;
    }

    try {
      const result = await ipc.scraper.retryFailed(paths);
      toast.success(`重试任务已启动，共 ${result.totalFiles} 个文件`);
      onOpenChange(false);
    } catch (_error) {
      toast.error("全部重试失败");
    }
  };

  const toggleFailedSelection = (path: string) => {
    setSelectedFailedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedFailedPaths.size === failedResults.length) {
      setSelectedFailedPaths(new Set());
      return;
    }

    setSelectedFailedPaths(new Set(failedResults.map((result) => result.path)));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              onOpenChange(false);
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
  );
}

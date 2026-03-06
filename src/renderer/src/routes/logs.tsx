import { createFileRoute } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDownToLine, Eraser, FileText, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils";
import { type RuntimeLog, useLogStore } from "@/store/logStore";

function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return timestamp;
  }
}

function VirtualLogList({ items, autoScroll }: { items: RuntimeLog[]; autoScroll: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 32,
    getItemKey: (index) => items[index]?.id ?? index,
    overscan: 10,
    useAnimationFrameWithResizeObserver: true,
  });

  useEffect(() => {
    if (!autoScroll || items.length === 0 || !scrollRef.current) return;
    virtualizer.scrollToIndex(items.length - 1, { align: "end" });
  }, [items.length, autoScroll, virtualizer]);

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-auto font-mono text-xs p-2"
      style={{
        overflowAnchor: "none",
        contain: "strict",
      }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const log = items[virtualRow.index];
          const isError = log.level === "error";
          const isWarning = log.level === "warning" || log.level === "warn";
          const isRequest = log.level === "request";

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "auto",
                minHeight: "28px",
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className={cn(
                "flex gap-3 px-3 py-1.5 hover:bg-muted/10 rounded transition-colors group",
                isError && "text-red-500/90",
                isWarning && "text-yellow-600/90",
              )}
            >
              <span className="shrink-0 opacity-40 select-none w-14">{formatTimestamp(log.timestamp)}</span>
              <span
                className={cn(
                  "shrink-0 font-bold w-16 uppercase tracking-tight select-none opacity-70",
                  isRequest && "text-blue-500",
                  !isError && !isWarning && !isRequest && "text-primary/70",
                )}
              >
                {log.level}
              </span>
              <div className="flex-1 break-words whitespace-pre-wrap leading-relaxed opacity-90 min-h-[20px]">
                {typeof log.message === "object" ? JSON.stringify(log.message) : log.message?.toString()}
              </div>
            </div>
          );
        })}
      </div>
      {items.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-40 gap-2">
          <FileText className="h-8 w-8 stroke-1" />
          <p className="text-xs">暂无相关日志内容</p>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute("/logs")({
  component: LogsComponent,
});

function LogsComponent() {
  const { logs, clearLogs } = useLogStore();
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState("");
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);

  const filteredLogs = useMemo(() => {
    if (!filter) return logs as RuntimeLog[];
    const lowerFilter = filter.toLowerCase();
    return logs.filter(
      (log) =>
        (log.message?.toString() || "").toLowerCase().includes(lowerFilter) ||
        log.level.toLowerCase().includes(lowerFilter),
    ) as RuntimeLog[];
  }, [logs, filter]);

  const mainLogs = useMemo(() => filteredLogs.filter((l) => l.level !== "request"), [filteredLogs]);
  const requestLogs = useMemo(() => filteredLogs.filter((l) => l.level === "request"), [filteredLogs]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PageHeader title="日志" subtitle="查看系统运行状态与网络请求详情" icon={FileText} />

      <div className="px-8 pb-2 border-b bg-background/60 backdrop-blur-md h-11 flex items-center">
        <div className="flex items-center justify-between flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-50" />
            <Input
              placeholder="搜索日志关键字..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="pl-9 h-9 bg-muted/30 border-none rounded-lg focus:ring-2"
            />
          </div>

          <div className="flex items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "h-9 rounded-lg gap-2 px-4",
                      autoScroll && "bg-primary/5 border-primary/20 text-primary",
                    )}
                    onClick={() => {
                      const newValue = !autoScroll;
                      setAutoScroll(newValue);
                      toast.info(newValue ? "已开启自动滚动" : "已关闭自动滚动");
                    }}
                  >
                    <ArrowDownToLine className={cn("h-4 w-4", !autoScroll && "opacity-50")} />
                    <span className="text-sm font-medium">自动滚动</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{autoScroll ? "点击关闭自动滚动" : "点击开启自动滚动"}</p>
                </TooltipContent>
              </Tooltip>

              <Dialog open={isClearDialogOpen} onOpenChange={setIsClearDialogOpen}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      className="h-9 rounded-lg gap-2 px-4 hover:bg-destructive/5 hover:text-destructive hover:border-destructive/20"
                      onClick={() => setIsClearDialogOpen(true)}
                    >
                      <Eraser className="h-4 w-4" />
                      <span className="text-sm font-medium">清空日志</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>清空当前所有日志内容</p>
                  </TooltipContent>
                </Tooltip>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>清空日志</DialogTitle>
                    <DialogDescription>确定要清空所有日志内容吗？此操作不可撤销。</DialogDescription>
                  </DialogHeader>
                  <DialogFooter className="gap-2 sm:gap-0">
                    <DialogClose asChild>
                      <Button variant="outline">取消</Button>
                    </DialogClose>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        clearLogs();
                        setIsClearDialogOpen(false);
                        toast.success("日志已成功清空");
                      }}
                    >
                      确定清空
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </TooltipProvider>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col p-4 md:p-6 space-y-4">
        <Tabs defaultValue="all" className="flex-1 min-h-0 flex flex-col gap-4">
          <div className="flex items-center justify-between shrink-0">
            <TabsList className="bg-muted/40 p-1 rounded-lg border-none h-auto">
              <TabsTrigger
                value="all"
                className="rounded-md px-3 py-1.5 text-xs font-medium data-[state=active]:bg-card data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-border/10"
              >
                全部
                <span className="ml-2 text-[10px] opacity-50 tabular-nums">{logs.length}</span>
              </TabsTrigger>
              <TabsTrigger
                value="main"
                className="rounded-md px-3 py-1.5 text-xs font-medium data-[state=active]:bg-card data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-border/10"
              >
                系统
                <span className="ml-2 text-[10px] opacity-50 tabular-nums">{mainLogs.length}</span>
              </TabsTrigger>
              <TabsTrigger
                value="request"
                className="rounded-md px-3 py-1.5 text-xs font-medium data-[state=active]:bg-card data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-border/10"
              >
                网络
                <span className="ml-2 text-[10px] opacity-50 tabular-nums">{requestLogs.length}</span>
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent
            value="all"
            className="flex-1 min-h-0 bg-card rounded-xl border shadow-sm overflow-hidden data-[state=active]:flex flex-col mt-0"
          >
            <VirtualLogList items={filteredLogs} autoScroll={autoScroll} />
          </TabsContent>
          <TabsContent
            value="main"
            className="flex-1 min-h-0 bg-card rounded-xl border shadow-sm overflow-hidden data-[state=active]:flex flex-col mt-0"
          >
            <VirtualLogList items={mainLogs} autoScroll={autoScroll} />
          </TabsContent>
          <TabsContent
            value="request"
            className="flex-1 min-h-0 bg-card rounded-xl border shadow-sm overflow-hidden data-[state=active]:flex flex-col mt-0"
          >
            <VirtualLogList items={requestLogs} autoScroll={autoScroll} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

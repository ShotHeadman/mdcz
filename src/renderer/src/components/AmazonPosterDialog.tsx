import type { AmazonPosterLookupResult, AmazonPosterScanItem } from "@shared/ipcTypes";
import { ArrowRight, Check, ImageIcon, LoaderCircle, Minus } from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useMemo, useState } from "react";
import { ipc } from "@/client/ipc";
import { ImageOptionCard } from "@/components/ImageOptionCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Progress } from "@/components/ui/Progress";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { useToast } from "@/contexts/ToastProvider";
import { cn } from "@/lib/utils";
import { getImageSrc } from "@/utils/image";

const LOOKUP_CONCURRENCY = 2;

type ItemState = {
  scan: AmazonPosterScanItem;
  lookup: AmazonPosterLookupResult | null;
  lookupStatus: "pending" | "loading" | "done" | "error";
  selection: "current" | "amazon" | null;
};

interface AmazonPosterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: AmazonPosterScanItem[];
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function formatElapsed(elapsedMs: number | null | undefined): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs === null || elapsedMs === undefined || elapsedMs < 0) {
    return "--";
  }
  return `${(elapsedMs / 1000).toFixed(1)}s`;
}

function SummaryThumb({
  src,
  loading = false,
  empty = false,
}: {
  src?: string | null;
  loading?: boolean;
  empty?: boolean;
}) {
  if (loading) {
    return <div className="h-[22px] w-8 rounded-md bg-muted/50 animate-pulse" />;
  }

  if (empty || !src) {
    return (
      <div className="flex h-[22px] w-8 items-center justify-center rounded-md border border-dashed border-muted-foreground/30 bg-muted/20">
        <ImageIcon className="h-3.5 w-3.5 text-muted-foreground/50" />
      </div>
    );
  }

  return (
    <img src={getImageSrc(src)} alt="thumbnail" className="h-[22px] w-8 rounded-md border bg-muted/20 object-cover" />
  );
}

function getStatusBadge(state: ItemState): {
  label: string;
  variant: "default" | "secondary" | "outline" | "destructive";
  icon: ComponentType<{ className?: string }>;
} {
  if (state.lookupStatus === "loading" || state.lookupStatus === "pending") {
    return { label: "查询中", variant: "secondary", icon: LoaderCircle };
  }

  if (state.lookupStatus === "error") {
    return { label: "查询失败", variant: "destructive", icon: Minus };
  }

  if (!state.lookup?.amazonPosterUrl) {
    return { label: "无结果", variant: "outline", icon: Minus };
  }

  if (state.selection === "current") {
    return { label: "保留当前", variant: "outline", icon: Check };
  }

  return { label: "✓ Amazon", variant: "default", icon: Check };
}

export function AmazonPosterDialog({ open, onOpenChange, items }: AmazonPosterDialogProps) {
  const { showError, showInfo, showSuccess } = useToast();
  const [itemStates, setItemStates] = useState<ItemState[]>([]);
  const [expandedIndex, setExpandedIndex] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) {
      setItemStates([]);
      setExpandedIndex(0);
      setConfirmOpen(false);
      setApplying(false);
      return;
    }

    const initialStates = items.map((scan) => ({
      scan,
      lookup: null,
      lookupStatus: "pending" as const,
      selection: null,
    }));

    setItemStates(initialStates);
    setExpandedIndex(0);
    setConfirmOpen(false);

    if (items.length === 0) {
      return;
    }

    let cancelled = false;
    let nextIndex = 0;

    const updateItem = (index: number, updater: (state: ItemState) => ItemState) => {
      setItemStates((prev) => prev.map((state, stateIndex) => (stateIndex === index ? updater(state) : state)));
    };

    const worker = async () => {
      while (!cancelled) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= items.length) {
          return;
        }

        updateItem(currentIndex, (state) => ({ ...state, lookupStatus: "loading" }));

        let result: AmazonPosterLookupResult;
        try {
          result = await ipc.tool.amazonPosterLookup(items[currentIndex].nfoPath, items[currentIndex].title);
        } catch (error) {
          result = {
            nfoPath: items[currentIndex].nfoPath,
            amazonPosterUrl: null,
            reason: `查询失败: ${formatError(error)}`,
            elapsedMs: 0,
          };
        }

        if (cancelled) {
          return;
        }

        updateItem(currentIndex, (state) => ({
          ...state,
          lookup: result,
          lookupStatus: result.reason.startsWith("查询失败:") ? "error" : "done",
          selection: result.amazonPosterUrl ? (state.selection === "current" ? "current" : "amazon") : state.selection,
        }));
      }
    };

    void Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, items.length) }, () => worker()));

    return () => {
      cancelled = true;
    };
  }, [items, open]);

  const completedCount = useMemo(
    () => itemStates.filter((state) => state.lookupStatus === "done" || state.lookupStatus === "error").length,
    [itemStates],
  );
  const hitCount = useMemo(
    () => itemStates.filter((state) => Boolean(state.lookup?.amazonPosterUrl)).length,
    [itemStates],
  );
  const selectedAmazonItems = useMemo(
    () =>
      itemStates
        .filter((state) => state.selection === "amazon" && state.lookup?.amazonPosterUrl)
        .map((state) => ({
          directory: state.scan.directory,
          amazonPosterUrl: state.lookup?.amazonPosterUrl ?? "",
        })),
    [itemStates],
  );

  const progressValue = itemStates.length > 0 ? Math.round((completedCount / itemStates.length) * 100) : 0;

  const handleSelectionChange = (index: number, selection: "current" | "amazon") => {
    setItemStates((prev) => prev.map((state, stateIndex) => (stateIndex === index ? { ...state, selection } : state)));
  };

  const handleApply = async () => {
    if (selectedAmazonItems.length === 0) {
      showInfo("当前没有选中的 Amazon 海报。");
      return;
    }

    setApplying(true);
    try {
      const result = await ipc.tool.amazonPosterApply(selectedAmazonItems);
      const successCount = result.results.filter((item) => item.success).length;
      const failedCount = result.results.length - successCount;

      if (failedCount === 0) {
        showSuccess(`已替换 ${successCount} 个 poster.jpg 文件。`);
      } else {
        showError(`替换完成：成功 ${successCount}，失败 ${failedCount}。`);
      }

      setConfirmOpen(false);
      onOpenChange(false);
    } catch (error) {
      showError(`海报替换失败: ${formatError(error)}`);
    } finally {
      setApplying(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setConfirmOpen(false);
          onOpenChange(nextOpen);
        }}
      >
        <DialogContent className="max-w-5xl gap-0 p-0 sm:max-w-5xl">
          <div className="border-b px-6 py-5">
            <DialogHeader className="space-y-3 text-left">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <DialogTitle>Amazon 海报增强</DialogTitle>
                  <DialogDescription>
                    已完成 {completedCount}/{itemStates.length}，命中 {hitCount} 条
                  </DialogDescription>
                </div>
              </div>
              <Progress value={progressValue} className="h-2 bg-muted/30" />
            </DialogHeader>
          </div>

          <ScrollArea className="max-h-[70vh] px-6 py-4">
            <div className="space-y-3 pr-3">
              {itemStates.length === 0 ? (
                <div className="flex min-h-48 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
                  未找到可处理的 NFO 条目
                </div>
              ) : (
                itemStates.map((state, index) => {
                  const isExpanded = index === expandedIndex;
                  const statusBadge = getStatusBadge(state);
                  const StatusIcon = statusBadge.icon;

                  return (
                    <div
                      key={state.scan.nfoPath}
                      className={cn(
                        "overflow-hidden rounded-xl border bg-card transition-all duration-300",
                        isExpanded ? "border-primary/30 shadow-sm" : "border-border/60",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setExpandedIndex(index)}
                        className={cn(
                          "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
                          isExpanded ? "bg-primary/5" : "hover:bg-muted/20",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <span className="shrink-0 text-primary">{state.scan.number}</span>
                            <span className="truncate text-foreground">{state.scan.title}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <SummaryThumb src={state.scan.currentPosterPath} empty={!state.scan.currentPosterPath} />
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                          <SummaryThumb
                            src={state.lookup?.amazonPosterUrl}
                            loading={state.lookupStatus === "loading" || state.lookupStatus === "pending"}
                            empty={state.lookupStatus !== "loading" && !state.lookup?.amazonPosterUrl}
                          />
                          <Badge variant={statusBadge.variant} className="h-6 gap-1 rounded-full px-2">
                            <StatusIcon className={cn("h-3 w-3", statusBadge.label === "查询中" && "animate-spin")} />
                            {statusBadge.label}
                          </Badge>
                        </div>
                      </button>

                      <div
                        className={cn(
                          "grid transition-all duration-300 ease-in-out",
                          isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                        )}
                      >
                        <div className="overflow-hidden">
                          <div className="space-y-3 border-t bg-muted/5 px-4 py-4">
                            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-foreground">{state.scan.number}</div>
                                <div className="text-sm text-muted-foreground break-all">{state.scan.title}</div>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                耗时 {formatElapsed(state.lookup?.elapsedMs)}
                              </div>
                            </div>

                            <div className="grid gap-3 md:grid-cols-2">
                              <ImageOptionCard
                                src={state.scan.currentPosterPath ?? ""}
                                label="当前海报"
                                width={state.scan.currentPosterWidth || null}
                                height={state.scan.currentPosterHeight || null}
                                subtitle={state.scan.currentPosterPath ? "本地 poster.jpg" : undefined}
                                selected={state.selection === "current"}
                                onClick={
                                  state.scan.currentPosterPath
                                    ? () => handleSelectionChange(index, "current")
                                    : undefined
                                }
                                empty={!state.scan.currentPosterPath}
                                emptyText="当前无海报"
                              />

                              <ImageOptionCard
                                src={state.lookup?.amazonPosterUrl ?? ""}
                                label="Amazon 海报"
                                subtitle={state.lookup?.amazonPosterUrl ? "Amazon.co.jp" : undefined}
                                selected={state.selection === "amazon"}
                                onClick={
                                  state.lookup?.amazonPosterUrl
                                    ? () => handleSelectionChange(index, "amazon")
                                    : undefined
                                }
                                loading={state.lookupStatus === "loading" || state.lookupStatus === "pending"}
                                empty={state.lookupStatus !== "loading" && !state.lookup?.amazonPosterUrl}
                                emptyText={
                                  state.lookupStatus === "loading" || state.lookupStatus === "pending"
                                    ? "正在查询 Amazon"
                                    : state.lookup?.reason || "未命中 Amazon 海报"
                                }
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>

          <DialogFooter className="border-t px-6 py-4 sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">已选择 {selectedAmazonItems.length} 条替换</div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button
                type="button"
                onClick={() => setConfirmOpen(true)}
                disabled={selectedAmazonItems.length === 0 || applying}
              >
                确认替换
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认替换海报</DialogTitle>
            <DialogDescription>
              即将替换 {selectedAmazonItems.length} 个条目的 poster.jpg 文件。此操作会覆盖现有海报，无法撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)} disabled={applying}>
              取消
            </Button>
            <Button type="button" onClick={handleApply} disabled={selectedAmazonItems.length === 0 || applying}>
              {applying ? "替换中..." : "确认"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

import type { AmazonPosterLookupResult, AmazonPosterScanItem } from "@mdcz/shared/ipcTypes";
import {
  Badge,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Progress,
  ScrollArea,
} from "@mdcz/ui";
import { ArrowRight, Check, FolderOpen, ImageIcon, LoaderCircle, Minus, ShoppingCart } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

const LOOKUP_CONCURRENCY = 2;
const TOOL_ICON_BUTTON_CLASS =
  "h-11 w-11 shrink-0 rounded-quiet-capsule bg-surface-floating text-foreground hover:bg-surface-raised/70";
const TOOL_INPUT_CLASS =
  "h-11 rounded-quiet-sm border-none bg-surface-floating px-4 text-sm shadow-none focus-visible:ring-2 focus-visible:ring-ring/30";
const TOOL_NOTE_CLASS = "text-xs leading-6 text-muted-foreground";
const TOOL_SECONDARY_BUTTON_CLASS =
  "h-11 rounded-quiet-capsule bg-surface-low px-6 text-sm font-semibold text-foreground hover:bg-surface-raised/75";
const TOOL_SUBSECTION_CLASS = "space-y-3 rounded-quiet-lg bg-surface-low/90 p-4 md:p-5";

type ItemState = {
  scan: AmazonPosterScanItem;
  lookup: AmazonPosterLookupResult | null;
  lookupStatus: "pending" | "loading" | "done" | "error";
  selection: "current" | "amazon" | null;
};

export interface AmazonPosterApplyItem {
  amazonPosterUrl: string;
  nfoPath: string;
}

export interface AmazonPosterImageOptionProps {
  empty?: boolean;
  emptyText?: string;
  label: string;
  loading?: boolean;
  onClick?: () => void;
  selected?: boolean;
  src: string;
  subtitle?: string;
  width?: number | null;
  height?: number | null;
}

export interface AmazonPosterWorkspaceDetailProps {
  dialogOpen: boolean;
  items: AmazonPosterScanItem[];
  scanning?: boolean;
  onApply: (items: AmazonPosterApplyItem[]) => void | Promise<void>;
  onBrowseDirectory?: () => Promise<string | null | undefined>;
  onDialogOpenChange: (open: boolean) => void;
  onLookup: (item: AmazonPosterScanItem) => Promise<AmazonPosterLookupResult>;
  onScan: (directory: string) => void | Promise<void>;
  renderImageOption?: (props: AmazonPosterImageOptionProps) => ReactNode;
  renderThumbnail?: (src: string | null | undefined, options?: { empty?: boolean; loading?: boolean }) => ReactNode;
}

function formatElapsed(elapsedMs: number | null | undefined): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs === null || elapsedMs === undefined || elapsedMs < 0) return "--";
  return `${(elapsedMs / 1000).toFixed(1)}s`;
}

function getFileNameFromPath(path: string | null | undefined): string | undefined {
  const value = path?.trim();
  if (!value) return undefined;
  return value
    .split(/[\\/]+/u)
    .filter(Boolean)
    .at(-1);
}

function getStatusBadge(state: ItemState): {
  label: string;
  variant: "default" | "secondary" | "outline" | "destructive";
  icon: ComponentType<{ className?: string }>;
} {
  if (state.lookupStatus === "loading" || state.lookupStatus === "pending") {
    return { label: "查询中", variant: "secondary", icon: LoaderCircle };
  }
  if (state.lookupStatus === "error") return { label: "查询失败", variant: "destructive", icon: Minus };
  if (!state.lookup?.amazonPosterUrl) return { label: "无结果", variant: "outline", icon: Minus };
  if (state.selection === "current") return { label: "保留当前", variant: "outline", icon: Check };
  return { label: "✓ Amazon", variant: "default", icon: Check };
}

function DefaultSummaryThumb({
  empty = false,
  loading = false,
  src,
}: {
  empty?: boolean;
  loading?: boolean;
  src?: string | null;
}) {
  if (loading) return <div className="h-[22px] w-8 animate-pulse rounded-md bg-muted/50" />;
  if (empty || !src) {
    return (
      <div className="flex h-[22px] w-8 items-center justify-center rounded-md border border-dashed border-muted-foreground/30 bg-muted/20">
        <ImageIcon className="h-3.5 w-3.5 text-muted-foreground/50" />
      </div>
    );
  }
  return <img src={src} alt="thumbnail" className="h-[22px] w-8 rounded-md border bg-muted/20 object-cover" />;
}

function DefaultImageOptionCard({
  empty,
  emptyText = "暂无图片",
  label,
  loading,
  onClick,
  selected,
  src,
  subtitle,
  width,
  height,
}: AmazonPosterImageOptionProps) {
  const clickable = Boolean(onClick) && !loading && !empty;
  const content = (
    <div className="flex min-w-0 flex-col gap-4 sm:flex-row">
      <div className="relative flex h-40 w-full shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/20 sm:w-48">
        {loading ? (
          <div className="h-full w-full animate-pulse bg-muted/40" />
        ) : empty || !src ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <ImageIcon className="h-8 w-8 opacity-40" />
            <span className="text-xs">{emptyText}</span>
          </div>
        ) : (
          <img src={src} alt={label} className="block h-full w-full max-w-full object-contain object-center" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
        <Badge variant={selected ? "default" : "secondary"}>{label}</Badge>
        <div className="text-sm text-foreground">
          <span className="text-muted-foreground">尺寸: </span>
          <span>{width && height ? `${width} × ${height}` : "未知"}</span>
        </div>
        {subtitle ? <div className="break-all text-sm text-muted-foreground">{subtitle}</div> : null}
      </div>
    </div>
  );
  const className = cn(
    "block w-full min-w-0 overflow-hidden rounded-xl bg-card p-4 text-left align-top transition-all duration-200",
    empty ? "border-2 border-dashed border-muted-foreground/25" : "border-2",
    selected ? "border-primary ring-2 ring-primary/20" : "border-transparent hover:border-muted-foreground/20",
    clickable && "cursor-pointer",
  );
  if (clickable) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {content}
      </button>
    );
  }
  return <div className={className}>{content}</div>;
}

export function AmazonPosterWorkspaceDetail({
  dialogOpen,
  items,
  scanning = false,
  onApply,
  onBrowseDirectory,
  onDialogOpenChange,
  onLookup,
  onScan,
  renderImageOption,
  renderThumbnail,
}: AmazonPosterWorkspaceDetailProps) {
  const [directory, setDirectory] = useState("");
  const [itemStates, setItemStates] = useState<ItemState[]>([]);
  const [expandedIndex, setExpandedIndex] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!dialogOpen) {
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

    if (items.length === 0) return;

    let cancelled = false;
    let nextIndex = 0;

    const updateItem = (index: number, updater: (state: ItemState) => ItemState) => {
      setItemStates((prev) => prev.map((state, stateIndex) => (stateIndex === index ? updater(state) : state)));
    };

    const worker = async () => {
      while (!cancelled) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= items.length) return;

        updateItem(currentIndex, (state) => ({ ...state, lookupStatus: "loading" }));

        let result: AmazonPosterLookupResult;
        try {
          result = await onLookup(items[currentIndex]);
        } catch (error) {
          result = {
            nfoPath: items[currentIndex].nfoPath,
            amazonPosterUrl: null,
            reason: error instanceof Error ? `查询失败: ${error.message}` : "查询失败",
            elapsedMs: 0,
          };
        }

        if (cancelled) return;

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
  }, [dialogOpen, items, onLookup]);

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
          nfoPath: state.scan.nfoPath,
          amazonPosterUrl: state.lookup?.amazonPosterUrl ?? "",
        })),
    [itemStates],
  );
  const progressValue = itemStates.length > 0 ? Math.round((completedCount / itemStates.length) * 100) : 0;
  const ImageOption =
    renderImageOption ?? ((props: AmazonPosterImageOptionProps) => <DefaultImageOptionCard {...props} />);

  const browseDirectory = async () => {
    const selected = await onBrowseDirectory?.();
    if (selected) setDirectory(selected);
  };

  const handleSelectionChange = (index: number, selection: "current" | "amazon") => {
    setItemStates((prev) => prev.map((state, stateIndex) => (stateIndex === index ? { ...state, selection } : state)));
  };

  const handleApply = async () => {
    setApplying(true);
    try {
      await onApply(selectedAmazonItems);
      setConfirmOpen(false);
    } finally {
      setApplying(false);
    }
  };

  return (
    <>
      <div className={TOOL_SUBSECTION_CLASS}>
        <Label
          htmlFor="amazon-poster-dir"
          className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
        >
          目标目录
        </Label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            id="amazon-poster-dir"
            value={directory}
            onChange={(event) => setDirectory(event.target.value)}
            placeholder="输入已刮削完成的输出目录"
            className={cn(TOOL_INPUT_CLASS, "flex-1")}
          />
          {onBrowseDirectory ? (
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className={TOOL_ICON_BUTTON_CLASS}
              onClick={browseDirectory}
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
        <p className={TOOL_NOTE_CLASS}>扫描完成后会打开批量处理弹窗，便于集中确认需要替换的海报条目。</p>
      </div>

      <Button
        variant="secondary"
        onClick={() => void onScan(directory)}
        disabled={scanning}
        className={cn(TOOL_SECONDARY_BUTTON_CLASS, "w-full sm:w-auto")}
      >
        <ShoppingCart className="h-4 w-4" />
        {scanning ? "正在扫描..." : "开始扫描"}
      </Button>

      <Dialog
        open={dialogOpen}
        onOpenChange={(nextOpen) => {
          setConfirmOpen(false);
          onDialogOpenChange(nextOpen);
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
                  const thumbnailLoading = state.lookupStatus === "loading" || state.lookupStatus === "pending";
                  const amazonEmpty = !thumbnailLoading && !state.lookup?.amazonPosterUrl;

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

                        <div className="flex shrink-0 items-center gap-2">
                          {renderThumbnail ? (
                            renderThumbnail(state.scan.currentPosterPath, { empty: !state.scan.currentPosterPath })
                          ) : (
                            <DefaultSummaryThumb
                              src={state.scan.currentPosterPath}
                              empty={!state.scan.currentPosterPath}
                            />
                          )}
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                          {renderThumbnail ? (
                            renderThumbnail(state.lookup?.amazonPosterUrl, {
                              loading: thumbnailLoading,
                              empty: amazonEmpty,
                            })
                          ) : (
                            <DefaultSummaryThumb
                              src={state.lookup?.amazonPosterUrl}
                              loading={thumbnailLoading}
                              empty={amazonEmpty}
                            />
                          )}
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
                                <div className="break-all text-sm text-muted-foreground">{state.scan.title}</div>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                耗时 {formatElapsed(state.lookup?.elapsedMs)}
                              </div>
                            </div>

                            <div className="grid gap-3 md:grid-cols-2">
                              <ImageOption
                                src={state.scan.currentPosterPath ?? ""}
                                label="当前海报"
                                width={state.scan.currentPosterWidth || null}
                                height={state.scan.currentPosterHeight || null}
                                subtitle={getFileNameFromPath(state.scan.currentPosterPath)}
                                selected={state.selection === "current"}
                                onClick={
                                  state.scan.currentPosterPath
                                    ? () => handleSelectionChange(index, "current")
                                    : undefined
                                }
                                empty={!state.scan.currentPosterPath}
                                emptyText="当前无海报"
                              />

                              <ImageOption
                                src={state.lookup?.amazonPosterUrl ?? ""}
                                label="Amazon 海报"
                                subtitle={state.lookup?.amazonPosterUrl ? "Amazon.co.jp" : undefined}
                                selected={state.selection === "amazon"}
                                onClick={
                                  state.lookup?.amazonPosterUrl
                                    ? () => handleSelectionChange(index, "amazon")
                                    : undefined
                                }
                                loading={thumbnailLoading}
                                empty={amazonEmpty}
                                emptyText={
                                  thumbnailLoading ? "正在查询 Amazon" : state.lookup?.reason || "未命中 Amazon 海报"
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
              <Button type="button" variant="outline" onClick={() => onDialogOpenChange(false)}>
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
              即将替换 {selectedAmazonItems.length} 个条目的海报文件。此操作会覆盖现有海报，无法撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)} disabled={applying}>
              取消
            </Button>
            <Button
              type="button"
              onClick={() => void handleApply()}
              disabled={selectedAmazonItems.length === 0 || applying}
            >
              {applying ? "替换中..." : "确认"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

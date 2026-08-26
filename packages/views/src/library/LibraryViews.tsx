import type { LibraryEntryDto } from "@mdcz/shared";
import { formatBytes } from "@mdcz/shared/format";
import {
  Badge,
  Button,
  Checkbox,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@mdcz/ui";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertCircle, Database, FolderOpen, LoaderCircle, RefreshCw, Search, Trash2 } from "lucide-react";
import { type ComponentType, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";

export type LibraryAvailabilityFilter = "all" | "available" | "unavailable";

export interface LibraryIndexViewProps {
  className?: string;
  entries: LibraryEntryDto[];
  errorMessage?: string | null;
  getImageSrc?: (path: string, entry: LibraryEntryDto) => string;
  isLoading?: boolean;
  isAvailabilityLoading?: boolean;
  isLoadingMore?: boolean;
  hasMore?: boolean;
  query: string;
  total: number;
  availabilityFilter: LibraryAvailabilityFilter;
  linkComponent?: ComponentType<{ children: ReactNode; className?: string; entry: LibraryEntryDto }>;
  onAvailabilityFilterChange: (value: LibraryAvailabilityFilter) => void;
  onDeleteEntry?: (entry: LibraryEntryDto) => void;
  onOpenFolder?: (entry: LibraryEntryDto) => void;
  onLoadMore?: () => void;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
}

export interface LibraryDeleteDialogProps {
  open: boolean;
  deleteMediaFiles?: boolean;
  showDeleteMediaFiles?: boolean;
  onDeleteMediaFilesChange?: (value: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

const availabilityFilters: Array<{ label: string; value: LibraryAvailabilityFilter }> = [
  { label: "全部", value: "all" },
  { label: "可用", value: "available" },
  { label: "不可用", value: "unavailable" },
];

export function LibraryIndexView({
  className,
  entries,
  errorMessage,
  getImageSrc = (path) => path,
  isLoading = false,
  isAvailabilityLoading = false,
  isLoadingMore = false,
  hasMore = false,
  query,
  total,
  availabilityFilter,
  linkComponent: LinkComponent,
  onAvailabilityFilterChange,
  onDeleteEntry,
  onOpenFolder,
  onLoadMore,
  onQueryChange,
  onRefresh,
}: LibraryIndexViewProps) {
  const mainRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const [listOffset, setListOffset] = useState(0);
  const { availableCount, filteredEntries, totalSize, unknownCount, unavailableCount } = useMemo(() => {
    let availableCount = 0;
    let unavailableCount = 0;
    let unknownCount = 0;
    let totalSize = 0;
    const filteredEntries: LibraryEntryDto[] = [];
    for (const entry of entries) {
      if (entry.available === true) availableCount += 1;
      else if (entry.available === false) unavailableCount += 1;
      else unknownCount += 1;
      const matchesAvailability =
        availabilityFilter === "all" ||
        (availabilityFilter === "available" && entry.available === true) ||
        (availabilityFilter === "unavailable" && entry.available === false);
      if (matchesAvailability) {
        filteredEntries.push(entry);
        totalSize += Number.isFinite(entry.size) ? entry.size : 0;
      }
    }
    return { availableCount, filteredEntries, totalSize, unknownCount, unavailableCount };
  }, [availabilityFilter, entries]);
  useLayoutEffect(() => {
    const updateOffset = () => setListOffset(listRef.current?.offsetTop ?? 0);
    updateOffset();
    const observer = new ResizeObserver(updateOffset);
    if (mainRef.current) observer.observe(mainRef.current);
    return () => observer.disconnect();
  }, []);
  const rowVirtualizer = useVirtualizer({
    count: filteredEntries.length,
    estimateSize: () => 112,
    getItemKey: (index) => filteredEntries[index]?.id ?? index,
    getScrollElement: () => mainRef.current,
    overscan: 6,
    scrollMargin: listOffset,
  });

  return (
    <TooltipProvider>
      <main className={cn("h-full overflow-y-auto bg-surface-canvas text-foreground", className)} ref={mainRef}>
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-6 py-8 lg:px-12 lg:py-10">
          <header className="flex flex-wrap items-center justify-end gap-x-10 gap-y-4">
            <Metric label="总数" value={total} />
            <Metric label="可用" value={availableCount} />
            <Metric className="text-amber-600 dark:text-amber-400" label="不可用" value={unavailableCount} />
            <Metric label={isAvailabilityLoading ? "检查中" : "未检查"} value={unknownCount} />
            <Metric label="大小" value={formatBytes(totalSize)} />
          </header>

          {errorMessage && (
            <div className="flex items-center gap-3 rounded-quiet border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {errorMessage}
            </div>
          )}

          <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="inline-flex shrink-0 rounded-quiet bg-surface-low p-1 shadow-inner">
              {availabilityFilters.map((filter) => (
                <Button
                  aria-pressed={availabilityFilter === filter.value}
                  className={cn(
                    "h-8 rounded-[var(--radius-quiet-sm)] px-4 text-xs font-bold text-muted-foreground transition-all",
                    availabilityFilter === filter.value && "bg-surface text-foreground shadow-sm",
                  )}
                  key={filter.value}
                  onClick={() => onAvailabilityFilterChange(filter.value)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {filter.label}
                </Button>
              ))}
            </div>
            <div className="flex flex-1 items-center gap-3 sm:max-w-[700px] sm:justify-end">
              <div className="relative w-full max-w-[520px]">
                <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
                <Input
                  aria-label="搜索媒体库"
                  className="h-10 border-transparent bg-surface-low pl-10 shadow-inner focus-visible:bg-surface focus-visible:ring-1"
                  onChange={(event) => onQueryChange(event.target.value)}
                  placeholder="搜索标题、番号、演员或相对路径..."
                  value={query}
                />
              </div>
              <Button className="h-10 shrink-0 px-5" onClick={onRefresh} type="button" variant="secondary">
                <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                刷新
              </Button>
            </div>
          </section>

          <section aria-label="媒体库条目" className="flex flex-col gap-3" ref={listRef}>
            {filteredEntries.length > 0 && (
              <div className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const entry = filteredEntries[virtualRow.index];
                  return (
                    <div
                      className="absolute top-0 left-0 w-full pb-3"
                      data-index={virtualRow.index}
                      key={entry.id}
                      ref={rowVirtualizer.measureElement}
                      style={{ transform: `translateY(${virtualRow.start - listOffset}px)` }}
                    >
                      <LibraryEntryRow
                        entry={entry}
                        getImageSrc={getImageSrc}
                        linkComponent={LinkComponent}
                        onDeleteEntry={onDeleteEntry}
                        onOpenFolder={onOpenFolder}
                      />
                    </div>
                  );
                })}
              </div>
            )}
            {filteredEntries.length === 0 && (
              <div className="flex min-h-[300px] flex-col items-center justify-center rounded-quiet-xl border border-dashed border-border/60 bg-surface-low/30 text-center text-muted-foreground">
                <Database className="mb-4 h-10 w-10 opacity-20" />
                {isAvailabilityLoading && availabilityFilter !== "all" && unknownCount > 0 ? (
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    正在检查可用性
                  </div>
                ) : (
                  <p className="text-sm font-medium">
                    {availabilityFilter !== "all" && unknownCount > 0
                      ? `暂无已确认条目，另有 ${unknownCount} 条尚未检查`
                      : "暂无匹配条目"}
                  </p>
                )}
              </div>
            )}
            {hasMore && (
              <div className="flex justify-center py-2">
                <Button disabled={isLoadingMore} onClick={onLoadMore} type="button" variant="secondary">
                  <LoaderCircle className={cn("h-4 w-4", isLoadingMore && "animate-spin")} />
                  加载更多
                </Button>
              </div>
            )}
          </section>
        </div>
      </main>
    </TooltipProvider>
  );
}

export function LibraryDeleteDialog({
  open,
  deleteMediaFiles = false,
  showDeleteMediaFiles = false,
  onDeleteMediaFilesChange,
  onCancel,
  onConfirm,
}: LibraryDeleteDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>从媒体库移除</DialogTitle>
        </DialogHeader>
        {showDeleteMediaFiles ? (
          <div className="flex items-center gap-3 rounded-quiet bg-surface-low px-4 py-3 text-sm font-medium text-foreground">
            <Checkbox
              checked={deleteMediaFiles}
              id="delete-media-files"
              onCheckedChange={(checked) => onDeleteMediaFilesChange?.(checked === true)}
            />
            <label className="cursor-pointer" htmlFor="delete-media-files">
              同时删除媒体文件
            </label>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            确认移除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Metric({ className, label, value }: { className?: string; label: string; value: ReactNode }) {
  return (
    <div className={cn("group flex flex-col items-end", className)}>
      <span className="text-[10px] font-bold tracking-[0.15em] text-muted-foreground/70 uppercase">{label}</span>
      <span className="font-numeric mt-0.5 text-lg font-extrabold tracking-tight text-foreground">{value}</span>
    </div>
  );
}

function LibraryEntryRow({
  entry,
  getImageSrc,
  linkComponent: LinkComponent,
  onDeleteEntry,
  onOpenFolder,
}: {
  entry: LibraryEntryDto;
  getImageSrc: (path: string, entry: LibraryEntryDto) => string;
  linkComponent?: ComponentType<{ children: ReactNode; className?: string; entry: LibraryEntryDto }>;
  onDeleteEntry?: (entry: LibraryEntryDto) => void;
  onOpenFolder?: (entry: LibraryEntryDto) => void;
}) {
  const id = entry.number || entry.crawlerData?.number || entry.mediaIdentity || entry.fileName;
  const title = entry.crawlerData?.title_zh || entry.title || entry.crawlerData?.title || entry.fileName;
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const imageSrc = !imageLoadFailed && entry.thumbnailPath ? getImageSrc(entry.thumbnailPath, entry) : "";
  const detailClass = "font-bold text-foreground/60 transition-colors hover:text-foreground";
  const canOpenFolder = Boolean(onOpenFolder && entry.available !== false && entry.lastKnownPath);

  return (
    <div className="group relative flex items-center gap-5 rounded-quiet-lg border border-border/40 bg-surface p-3.5 shadow-[0_2px_8px_rgba(0,0,0,0.02)] transition-all hover:border-border/80 hover:bg-surface-floating hover:shadow-[0_12px_24px_rgba(0,0,0,0.06)] lg:gap-6">
      <div className="relative h-[72px] w-12 shrink-0 overflow-hidden rounded-[var(--radius-quiet-sm)] bg-surface-low shadow-sm">
        {imageSrc ? (
          <img
            alt={title}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setImageLoadFailed(true)}
            src={imageSrc}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-low to-surface-raised text-[10px] font-numeric font-bold text-muted-foreground">
            {id.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <div className="flex items-center gap-3">
          <span className="shrink-0 rounded bg-foreground/5 px-2 py-0.5 font-mono text-[11px] font-bold tracking-wider text-foreground/60">
            {id}
          </span>
          <span className="truncate text-base font-bold tracking-tight text-foreground">{title}</span>
        </div>
        <div className="mt-2 flex items-center gap-3 text-[11px]">
          <ActorChips actors={entry.actors} />
          <MiddleEllipsisPath rootDisplayName={entry.rootDisplayName} relativePath={entry.relativePath} />
        </div>
      </div>
      <div className="hidden shrink-0 items-center gap-8 font-numeric text-xs font-bold text-muted-foreground/60 lg:flex">
        <div className="flex flex-col items-end">
          <span className="text-[10px] font-bold uppercase opacity-50">大小</span>
          <span className="text-foreground/80">{formatBytes(entry.size)}</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[10px] font-bold uppercase opacity-50">修改时间</span>
          <span className="text-foreground/80">{formatDate(entry.modifiedAt || entry.createdAt)}</span>
        </div>
      </div>
      <div className="flex items-center gap-4 pl-4 lg:gap-6">
        <StatusActionSlot available={entry.available} entry={entry} onDeleteEntry={onDeleteEntry} />
        <div className="flex items-center gap-1.5">
          {LinkComponent ? (
            <LinkComponent className={detailClass} entry={entry}>
              <Badge className="px-3 py-1 font-bold tracking-wide" variant="secondary">
                详情
              </Badge>
            </LinkComponent>
          ) : null}
          {canOpenFolder ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label="打开所在目录"
                  className="h-8 w-8 text-muted-foreground transition-all hover:bg-surface-raised hover:text-foreground lg:opacity-0 lg:group-hover:opacity-100"
                  onClick={() => onOpenFolder?.(entry)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>打开所在目录</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StatusActionSlot({
  available,
  entry,
  onDeleteEntry,
}: {
  available: boolean | null;
  entry: LibraryEntryDto;
  onDeleteEntry?: (entry: LibraryEntryDto) => void;
}) {
  if (!onDeleteEntry) {
    return <StatusDot available={available} />;
  }

  return (
    <div className="relative flex h-8 w-8 shrink-0 items-center justify-center">
      <div className="transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
        <StatusDot available={available} />
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label="从媒体库移除"
            className="absolute inset-0 h-8 w-8 text-muted-foreground opacity-0 transition-all hover:bg-surface-raised hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100"
            onClick={() => onDeleteEntry(entry)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>从媒体库移除</TooltipContent>
      </Tooltip>
    </div>
  );
}

function StatusDot({ available }: { available: boolean | null }) {
  if (available === false) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="h-2 w-2 shrink-0 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
        </TooltipTrigger>
        <TooltipContent>原路径不可用</TooltipContent>
      </Tooltip>
    );
  }
  if (available === null) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/30" />
        </TooltipTrigger>
        <TooltipContent>可用性尚未检查</TooltipContent>
      </Tooltip>
    );
  }
  return <div className="h-2 w-2 shrink-0 rounded-full bg-emerald-500/40" />;
}

function ActorChips({ actors }: { actors: string[] }) {
  return (
    <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
      {actors.slice(0, 3).map((actor) => (
        <span
          className="rounded-full border border-border/80 bg-surface-low px-2.5 py-0.5 text-[11px] font-semibold text-foreground/80"
          key={actor}
        >
          {actor}
        </span>
      ))}
      {actors.length > 3 && (
        <span className="font-numeric text-[11px] font-bold text-muted-foreground/40">+{actors.length - 3}</span>
      )}
    </div>
  );
}

function MiddleEllipsisPath({ rootDisplayName, relativePath }: { rootDisplayName: string; relativePath: string }) {
  const normalizedRoot = rootDisplayName.trim();
  const normalizedRelative = relativePath.trim().replace(/^[\\/]+/u, "");
  const fullPath = [normalizedRoot, normalizedRelative].filter(Boolean).join(" / ");

  return (
    <span
      className="flex min-w-0 flex-1 items-center overflow-hidden font-mono font-medium text-muted-foreground/70"
      title={fullPath}
    >
      <span className="min-w-0 truncate">{normalizedRoot}</span>
      {normalizedRelative ? (
        <>
          <span className="shrink-0 px-1">/</span>
          <span className="min-w-0 truncate text-right [direction:rtl]">
            <span className="[unicode-bidi:plaintext]">{normalizedRelative}</span>
          </span>
        </>
      ) : null}
    </span>
  );
}

const formatDate = (value: string | null | undefined): string =>
  value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value)) : "-";

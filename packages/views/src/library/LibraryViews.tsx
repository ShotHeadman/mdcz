import type { LibraryEntryDto } from "@mdcz/shared";
import { formatBytes } from "@mdcz/shared/format";
import type { LibraryFileRemoveInput, LibraryRelinkInput } from "@mdcz/shared/serverDtos";
import {
  Badge,
  Button,
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
import { useT } from "../i18n";

export type LibraryAvailabilityFilter = "all" | LibraryEntryDto["available"];

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
  fileCount?: number;
  totalBytes?: number;
  availabilityFilter: LibraryAvailabilityFilter;
  linkComponent?: ComponentType<{ children: ReactNode; className?: string; entry: LibraryEntryDto }>;
  onAvailabilityFilterChange: (value: LibraryAvailabilityFilter) => void;
  onDeleteEntry?: (entry: LibraryEntryDto) => void;
  onOpenFolder?: (path: string) => void;
  onRemoveFile?: (input: LibraryFileRemoveInput) => Promise<void>;
  onRelinkFile?: (input: LibraryRelinkInput) => Promise<void>;
  onLoadMore?: () => void;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
}

export interface LibraryDeleteDialogProps {
  entry?: LibraryEntryDto | null;
  open: boolean;
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

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
  fileCount,
  totalBytes,
  availabilityFilter,
  linkComponent: LinkComponent,
  onAvailabilityFilterChange,
  onDeleteEntry,
  onOpenFolder,
  onRemoveFile,
  onRelinkFile,
  onLoadMore,
  onQueryChange,
  onRefresh,
}: LibraryIndexViewProps) {
  const t = useT();
  const mainRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const [listOffset, setListOffset] = useState(0);

  const availabilityFilters = useMemo<Array<{ label: string; value: LibraryAvailabilityFilter }>>(
    () => [
      { label: t.library.filter.all, value: "all" },
      { label: t.library.filter.available, value: "available" },
      { label: t.library.filter.unavailable, value: "unavailable" },
      { label: t.library.filter.partial, value: "partial" },
      { label: t.library.filter.unchecked, value: "unchecked" },
    ],
    [t.library.filter],
  );

  const { availableCount, filteredEntries, totalSize, unknownCount, unavailableCount } = useMemo(() => {
    let availableCount = 0;
    let unavailableCount = 0;
    let unknownCount = 0;
    let totalSize = 0;
    const filteredEntries: LibraryEntryDto[] = [];
    for (const entry of entries) {
      if (entry.available === "available") availableCount += 1;
      else if (entry.available === "unavailable") unavailableCount += 1;
      else if (entry.available === "unchecked") unknownCount += 1;
      const matchesAvailability = availabilityFilter === "all" || availabilityFilter === entry.available;
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
            <Metric label={t.library.metrics.movies} value={total} />
            <Metric
              label={t.library.metrics.files}
              value={fileCount ?? entries.reduce((count, entry) => count + entry.fileRefs.length, 0)}
            />
            <Metric label={t.library.metrics.available} value={availableCount} />
            <Metric
              className="text-amber-600 dark:text-amber-400"
              label={t.library.metrics.unavailable}
              value={unavailableCount}
            />
            <Metric
              label={isAvailabilityLoading ? t.library.metrics.checking : t.library.metrics.unchecked}
              value={unknownCount}
            />
            <Metric label={t.library.metrics.totalSize} value={formatBytes(totalBytes ?? totalSize)} />
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
                  aria-label={t.library.searchAriaLabel}
                  className="h-10 border-transparent bg-surface-low pl-10 shadow-inner focus-visible:bg-surface focus-visible:ring-1"
                  onChange={(event) => onQueryChange(event.target.value)}
                  placeholder={t.library.searchPlaceholder}
                  value={query}
                />
              </div>
              <Button className="h-10 shrink-0 px-5" onClick={onRefresh} type="button" variant="secondary">
                <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                {t.library.refresh}
              </Button>
            </div>
          </section>

          <section aria-label={t.library.listAriaLabel} className="flex flex-col gap-3" ref={listRef}>
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
                        onRemoveFile={onRemoveFile}
                        onRelinkFile={onRelinkFile}
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
                    {t.library.checkingAvailability}
                  </div>
                ) : (
                  <p className="text-sm font-medium">
                    {availabilityFilter !== "all" && unknownCount > 0
                      ? t.library.noConfirmedEntries(unknownCount)
                      : t.library.noMatchingEntries}
                  </p>
                )}
              </div>
            )}
            {hasMore && (
              <div className="flex justify-center py-2">
                <Button disabled={isLoadingMore} onClick={onLoadMore} type="button" variant="secondary">
                  <LoaderCircle className={cn("h-4 w-4", isLoadingMore && "animate-spin")} />
                  {t.library.loadMore}
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
  entry,
  open,
  submitting = false,
  onCancel,
  onConfirm,
}: LibraryDeleteDialogProps) {
  const t = useT();
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
          <DialogTitle>{t.library.removeDialogTitle}</DialogTitle>
        </DialogHeader>
        {entry && <p>{t.library.removeDialogDescription(entry.fileRefs.length, entry.assets.length)}</p>}
        <p className="text-sm text-muted-foreground">{t.library.diskFilesUnchanged}</p>
        <DialogFooter>
          <Button disabled={submitting} variant="outline" onClick={onCancel}>
            {t.common.cancel}
          </Button>
          <Button disabled={submitting} variant="destructive" onClick={onConfirm}>
            {submitting ? t.library.removing : t.library.confirmRemove}
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
  onRemoveFile,
  onRelinkFile,
}: {
  entry: LibraryEntryDto;
  getImageSrc: (path: string, entry: LibraryEntryDto) => string;
  linkComponent?: ComponentType<{ children: ReactNode; className?: string; entry: LibraryEntryDto }>;
  onDeleteEntry?: (entry: LibraryEntryDto) => void;
  onOpenFolder?: (path: string) => void;
  onRemoveFile?: LibraryIndexViewProps["onRemoveFile"];
  onRelinkFile?: LibraryIndexViewProps["onRelinkFile"];
}) {
  const displayFile = entry.fileRefs.find((file) => file.id === entry.displayFileId);
  const id = entry.number || entry.crawlerData?.number || entry.mediaIdentity || displayFile?.fileName || entry.id;
  const title =
    entry.crawlerData?.title_zh || entry.title || entry.crawlerData?.title || displayFile?.fileName || entry.id;
  const t = useT();
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const imageSrc = !imageLoadFailed && entry.thumbnailPath ? getImageSrc(entry.thumbnailPath, entry) : "";
  const detailClass = "font-bold text-foreground/60 transition-colors hover:text-foreground";
  const canOpenFolder = Boolean(onOpenFolder && entry.available !== "unavailable" && displayFile?.lastKnownPath);

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
          {displayFile && (
            <MiddleEllipsisPath rootDisplayName={displayFile.rootDisplayName} relativePath={displayFile.relativePath} />
          )}
        </div>
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer">
            {t.library.fileCountWithStatus(entry.fileRefs.length, t.library.availability[entry.available])}
          </summary>
          {entry.fileRefs.map((file) => (
            <LibraryFileRow
              key={file.id}
              entry={entry}
              file={file}
              onOpenFolder={onOpenFolder}
              onRemoveFile={onRemoveFile}
              onRelinkFile={onRelinkFile}
            />
          ))}
        </details>
      </div>
      <div className="hidden shrink-0 items-center gap-8 font-numeric text-xs font-bold text-muted-foreground/60 lg:flex">
        <div className="flex flex-col items-end">
          <span className="text-[10px] font-bold uppercase opacity-50">{t.library.size}</span>
          <span className="text-foreground/80">{formatBytes(entry.size)}</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[10px] font-bold uppercase opacity-50">{t.library.updatedTime}</span>
          <span className="text-foreground/80">{formatDate(latestEntryUpdate(entry))}</span>
        </div>
      </div>
      <div className="flex items-center gap-4 pl-4 lg:gap-6">
        <StatusActionSlot available={entry.available} entry={entry} onDeleteEntry={onDeleteEntry} />
        <div className="flex items-center gap-1.5">
          {LinkComponent ? (
            <LinkComponent className={detailClass} entry={entry}>
              <Badge className="px-3 py-1 font-bold tracking-wide" variant="secondary">
                {t.library.scrapeInfo}
              </Badge>
            </LinkComponent>
          ) : null}
          {canOpenFolder ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t.library.openFolder}
                  className="h-8 w-8 text-muted-foreground transition-all hover:bg-surface-raised hover:text-foreground lg:opacity-0 lg:group-hover:opacity-100"
                  onClick={() => displayFile?.lastKnownPath && onOpenFolder?.(displayFile.lastKnownPath)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t.library.openFolder}</TooltipContent>
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
  available: LibraryEntryDto["available"];
  entry: LibraryEntryDto;
  onDeleteEntry?: (entry: LibraryEntryDto) => void;
}) {
  const t = useT();
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
            aria-label={t.library.removeFromLibrary}
            className="absolute inset-0 h-8 w-8 text-muted-foreground opacity-0 transition-all hover:bg-surface-raised hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100"
            onClick={() => onDeleteEntry(entry)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t.library.removeFromLibrary}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function StatusDot({ available }: { available: LibraryEntryDto["available"] }) {
  const t = useT();
  if (available === "unavailable" || available === "partial") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="h-2 w-2 shrink-0 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
        </TooltipTrigger>
        <TooltipContent>{t.library.availability[available]}</TooltipContent>
      </Tooltip>
    );
  }
  if (available === "unchecked") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/30" />
        </TooltipTrigger>
        <TooltipContent>{t.library.availabilityNotChecked}</TooltipContent>
      </Tooltip>
    );
  }
  return <div className="h-2 w-2 shrink-0 rounded-full bg-emerald-500/40" />;
}

function LibraryFileRow({
  entry,
  file,
  onOpenFolder,
  onRemoveFile,
  onRelinkFile,
}: {
  entry: LibraryEntryDto;
  file: LibraryEntryDto["fileRefs"][number];
  onOpenFolder?: LibraryIndexViewProps["onOpenFolder"];
  onRemoveFile?: LibraryIndexViewProps["onRemoveFile"];
  onRelinkFile?: LibraryIndexViewProps["onRelinkFile"];
}) {
  const t = useT();
  const [action, setAction] = useState<"remove" | "relink" | null>(null);
  const [relativePath, setRelativePath] = useState(file.relativePath);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = file.lastKnownPath ?? file.relativePath;
  return (
    <div className="mt-2 grid gap-2 rounded border p-2">
      <div>
        {file.partNumber ? `CD${file.partNumber} · ` : ""}
        {file.fileName}
        {file.resolution ? ` · ${file.resolution}` : ""} · {formatBytes(file.size)} ·{" "}
        {file.available === null
          ? t.library.fileStatus.unchecked
          : file.available
            ? t.library.fileStatus.available
            : t.library.fileStatus.unavailable}
      </div>
      <div className="break-all font-mono">{path}</div>
      {file.availabilityError && <p className="text-destructive">{file.availabilityError}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void navigator.clipboard.writeText(path).catch((cause) => setError(String(cause)));
          }}
        >
          {t.library.copyPath}
        </Button>
        {onOpenFolder && (
          <Button size="sm" variant="ghost" onClick={() => onOpenFolder(path)}>
            {t.library.openLocation}
          </Button>
        )}
        {onRelinkFile && (
          <Button size="sm" variant="ghost" onClick={() => setAction("relink")}>
            {t.library.relink}
          </Button>
        )}
        {onRemoveFile && (
          <Button size="sm" variant="ghost" onClick={() => setAction("remove")}>
            {t.library.removeFile}
          </Button>
        )}
      </div>
      {error && <p className="text-destructive">{error}</p>}
      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setAction(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{action === "remove" ? t.library.removeFile : t.library.relinkFileTitle}</DialogTitle>
          </DialogHeader>
          <p className="break-all">{path}</p>
          {action === "remove" ? (
            <>
              <p>{entry.fileRefs.length === 1 ? t.library.lastFileWarning : t.library.removeFileDescription}</p>
              <p>{t.library.diskFilesUnchanged}</p>
            </>
          ) : (
            <>
              <p>{t.library.mediaFolderLabel(file.rootDisplayName)}</p>
              <label htmlFor={`relink-path-${file.id}`}>
                {t.library.newRelativePath}
                <Input
                  id={`relink-path-${file.id}`}
                  value={relativePath}
                  onChange={(event) => setRelativePath(event.target.value)}
                />
              </label>
            </>
          )}
          <DialogFooter>
            <Button disabled={busy} onClick={() => setAction(null)}>
              {t.common.cancel}
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  if (action === "remove") await onRemoveFile?.({ fileId: file.id });
                  else await onRelinkFile?.({ fileId: file.id, rootId: file.rootId, relativePath });
                  setAction(null);
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : String(cause));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t.library.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
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

const latestEntryUpdate = (entry: Pick<LibraryEntryDto, "createdAt" | "lastRefreshedAt" | "fileRefs">): string =>
  [entry.createdAt, entry.lastRefreshedAt, ...entry.fileRefs.map((file) => file.modifiedAt)]
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? entry.createdAt;

import type { LibraryEntryDto } from "@mdcz/shared";
import { toErrorMessage } from "@mdcz/shared/error";
import { formatBytes } from "@mdcz/shared/format";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { LibraryFileRemoveInput, LibraryRelinkInput } from "@mdcz/shared/serverDtos";
import {
  Badge,
  Button,
  cn,
  copyText,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@mdcz/ui";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertCircle,
  ChevronDown,
  Copy,
  Database,
  FolderOpen,
  Layers,
  LayoutGrid,
  Link2,
  List,
  LoaderCircle,
  MoreHorizontal,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { type ComponentType, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useT } from "../i18n";
import { type LibraryBrowseControls, LibraryBrowsePanel } from "./LibraryBrowsePanel";
import { LibraryPosterWall } from "./LibraryPosterWall";

const ALL_LIBRARIES = "__all__";

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
  browse?: LibraryBrowseControls;
  onAvailabilityFilterChange: (value: LibraryAvailabilityFilter) => void;
  onDeleteEntry?: (entry: LibraryEntryDto) => void;
  onOpenFolder?: (file: RootFileRef) => void;
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
  browse,
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

  const { availableCount, filteredEntries, partialCount, totalSize, unknownCount, unavailableCount } = useMemo(() => {
    let availableCount = 0;
    let unavailableCount = 0;
    let partialCount = 0;
    let unknownCount = 0;
    let totalSize = 0;
    const filteredEntries: LibraryEntryDto[] = [];
    for (const entry of entries) {
      if (entry.available === "available") availableCount += 1;
      else if (entry.available === "unavailable") unavailableCount += 1;
      else if (entry.available === "partial") partialCount += 1;
      else if (entry.available === "unchecked") unknownCount += 1;
      const matchesAvailability = availabilityFilter === "all" || availabilityFilter === entry.available;
      if (matchesAvailability) {
        filteredEntries.push(entry);
        totalSize += Number.isFinite(entry.size) ? entry.size : 0;
      }
    }
    return { availableCount, filteredEntries, partialCount, totalSize, unknownCount, unavailableCount };
  }, [availabilityFilter, entries]);

  const availabilityFilters = useMemo<Array<{ count: number; label: string; value: LibraryAvailabilityFilter }>>(
    () =>
      (
        [
          { label: t.library.filter.all, value: "all", count: entries.length },
          { label: t.library.filter.available, value: "available", count: availableCount },
          { label: t.library.filter.unavailable, value: "unavailable", count: unavailableCount },
          { label: t.library.filter.partial, value: "partial", count: partialCount },
          { label: t.library.filter.unchecked, value: "unchecked", count: unknownCount },
        ] as const
      ).filter(
        (filter) =>
          filter.value === "all" ||
          filter.value === "available" ||
          filter.count > 0 ||
          availabilityFilter === filter.value,
      ),
    [
      availabilityFilter,
      availableCount,
      entries.length,
      partialCount,
      t.library.filter,
      unavailableCount,
      unknownCount,
    ],
  );

  const resolvedFileCount = fileCount ?? entries.reduce((count, entry) => count + entry.fileRefs.length, 0);
  const summaryText = `${t.library.metrics.movies} ${total} · ${t.library.metrics.files} ${resolvedFileCount} · ${formatBytes(totalBytes ?? totalSize)}`;

  useLayoutEffect(() => {
    const updateOffset = () => setListOffset(listRef.current?.offsetTop ?? 0);
    updateOffset();
    const observer = new ResizeObserver(updateOffset);
    if (mainRef.current) observer.observe(mainRef.current);
    return () => observer.disconnect();
  }, []);
  const rowVirtualizer = useVirtualizer({
    count: filteredEntries.length,
    estimateSize: () => 104,
    getItemKey: (index) => filteredEntries[index]?.id ?? index,
    getScrollElement: () => mainRef.current,
    overscan: 6,
    scrollMargin: listOffset,
  });

  return (
    <TooltipProvider>
      <main className={cn("h-full overflow-y-auto bg-surface-canvas text-foreground", className)} ref={mainRef}>
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-6 py-6 lg:px-12 lg:py-8">
          {errorMessage && (
            <div className="flex items-center gap-3 rounded-quiet border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {errorMessage}
            </div>
          )}

          <section className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              {browse && browse.libraries.length > 1 ? (
                <Select
                  value={browse.libraryId ?? ALL_LIBRARIES}
                  onValueChange={(value) => browse.onLibraryChange(value === ALL_LIBRARIES ? undefined : value)}
                >
                  <SelectTrigger aria-label={t.library.libraryAriaLabel} className="h-9 w-full sm:w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_LIBRARIES}>{t.library.allLibraries}</SelectItem>
                    {browse.libraries.map((library) => (
                      <SelectItem key={library.id} value={library.id}>
                        {library.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}

              <div className="inline-flex shrink-0 flex-wrap rounded-quiet bg-surface-low p-1 shadow-inner">
                {availabilityFilters.map((filter) => (
                  <Button
                    aria-pressed={availabilityFilter === filter.value}
                    className={cn(
                      "h-7 gap-1.5 rounded-[var(--radius-quiet-sm)] px-3 text-xs font-bold text-muted-foreground transition-all",
                      availabilityFilter === filter.value && "bg-surface text-foreground shadow-sm",
                    )}
                    key={filter.value}
                    onClick={() => onAvailabilityFilterChange(filter.value)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <span>{filter.label}</span>
                    <span className="font-numeric text-[11px] opacity-60">{filter.count}</span>
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex flex-1 items-center gap-2.5 sm:justify-end">
              <div className="relative min-w-[200px] flex-1 sm:max-w-[380px]">
                <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
                <Input
                  aria-label={t.library.searchAriaLabel}
                  className="h-9 border-transparent bg-surface-low pl-9 text-sm shadow-inner focus-visible:bg-surface focus-visible:ring-1"
                  onChange={(event) => onQueryChange(event.target.value)}
                  placeholder={t.library.searchPlaceholder}
                  value={query}
                />
              </div>
              <Button className="h-9 shrink-0 px-3.5" onClick={onRefresh} size="sm" type="button" variant="secondary">
                <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
                {t.library.refresh}
              </Button>
              {browse ? (
                <div className="inline-flex shrink-0 rounded-quiet bg-surface-low p-1 shadow-inner">
                  {(["list", "wall"] as const).map((view) => (
                    <Button
                      aria-pressed={browse.view === view}
                      className={cn(
                        "h-7 gap-1.5 rounded-[var(--radius-quiet-sm)] px-3 text-xs font-bold text-muted-foreground",
                        browse.view === view && "bg-surface text-foreground shadow-sm",
                      )}
                      key={view}
                      onClick={() => browse.onViewChange(view)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {view === "list" ? <List className="h-3.5 w-3.5" /> : <LayoutGrid className="h-3.5 w-3.5" />}
                      {t.library.view[view]}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          {browse ? (
            <LibraryBrowsePanel browse={browse} matchCount={total} summaryText={summaryText} />
          ) : (
            <div className="flex items-center justify-end font-numeric text-xs text-muted-foreground">
              {summaryText}
            </div>
          )}

          <section aria-label={t.library.listAriaLabel} className="flex flex-col gap-3" ref={listRef}>
            {filteredEntries.length > 0 && browse?.view === "wall" && (
              <LibraryPosterWall entries={filteredEntries} getImageSrc={getImageSrc} linkComponent={LinkComponent} />
            )}
            {filteredEntries.length > 0 && browse?.view !== "wall" && (
              <div className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const entry = filteredEntries[virtualRow.index];
                  return (
                    <div
                      className="absolute top-0 left-0 w-full pb-2.5"
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
                <Database className="mb-3 h-10 w-10 text-muted-foreground/40" />
                {isAvailabilityLoading && availabilityFilter !== "all" && unknownCount > 0 ? (
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    {t.library.checkingAvailability}
                  </div>
                ) : (
                  <p className="text-sm">
                    {availabilityFilter !== "all" && unknownCount > 0
                      ? t.library.noConfirmedEntries(unknownCount)
                      : total === 0 && !query.trim() && !browse?.health && !browse?.facet
                        ? t.library.nothingIndexed
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
  onOpenFolder?: LibraryIndexViewProps["onOpenFolder"];
  onRemoveFile?: LibraryIndexViewProps["onRemoveFile"];
  onRelinkFile?: LibraryIndexViewProps["onRelinkFile"];
}) {
  const displayFile = entry.fileRefs.find((file) => file.id === entry.displayFileId);
  const id = entry.number || entry.crawlerData?.number || entry.mediaIdentity || displayFile?.fileName || entry.id;
  const title =
    entry.crawlerData?.title_zh || entry.title || entry.crawlerData?.title || displayFile?.fileName || entry.id;
  const t = useT();
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const imageSrc = !imageLoadFailed && entry.thumbnailPath ? getImageSrc(entry.thumbnailPath, entry) : "";
  const detailClass = "font-bold text-foreground/60 transition-colors hover:text-foreground";
  const canOpenFolder = Boolean(onOpenFolder && entry.available !== "unavailable" && displayFile);
  const isMultiFile = entry.fileRefs.length > 1;
  const missingFileCount = entry.fileRefs.filter((file) => file.available === false).length;
  const fileActionProps = { entry, onOpenFolder, onRemoveFile, onRelinkFile };

  return (
    <div className="group rounded-quiet-lg border border-border/40 bg-surface p-3 shadow-[0_2px_8px_rgba(0,0,0,0.02)] transition-all hover:border-border/80 hover:bg-surface-floating hover:shadow-[0_12px_24px_rgba(0,0,0,0.06)]">
      <div className="relative flex flex-wrap items-center gap-x-5 gap-y-3 lg:flex-nowrap lg:gap-6">
        <div className="relative h-[68px] w-12 shrink-0 overflow-hidden rounded-[var(--radius-quiet-sm)] bg-surface-low shadow-sm">
          {imageSrc ? (
            <img
              alt={title}
              className="h-full w-full object-cover"
              onError={() => setImageLoadFailed(true)}
              src={imageSrc}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-low to-surface-raised text-[10px] font-numeric font-bold text-muted-foreground">
              {id.slice(0, 2).toUpperCase()}
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 basis-40 flex-col justify-center">
          <div className="flex items-center gap-2.5">
            <span className="shrink-0 rounded bg-foreground/5 px-2 py-0.5 font-mono text-[11px] font-bold tracking-wider text-foreground/60">
              {id}
            </span>
            <span className="truncate text-base font-bold tracking-tight text-foreground">{title}</span>
          </div>
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[11px]">
            <ActorChips actors={entry.actors} />
            {isMultiFile && (
              <button
                aria-expanded={filesOpen}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 font-semibold transition-colors",
                  missingFileCount > 0
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
                    : "border-border/80 bg-surface-low text-foreground/70 hover:text-foreground",
                )}
                onClick={() => setFilesOpen((open) => !open)}
                type="button"
              >
                <Layers className="h-3 w-3" />
                {missingFileCount > 0
                  ? t.library.partsMissing(missingFileCount, entry.fileRefs.length)
                  : t.library.parts(entry.fileRefs.length)}
                <ChevronDown className={cn("h-3 w-3 transition-transform", filesOpen && "rotate-180")} />
              </button>
            )}
            {displayFile && (
              <span
                className="truncate font-mono font-medium text-muted-foreground/70"
                title={[displayFile.rootDisplayName, displayFile.relativePath].filter(Boolean).join(" / ")}
              >
                {displayFile.fileName}
              </span>
            )}
          </div>
        </div>
        <div className="hidden shrink-0 items-center gap-6 font-numeric text-xs font-semibold text-muted-foreground lg:flex">
          <span className="text-foreground/75">{formatBytes(entry.size)}</span>
          <span className="min-w-24 text-right text-muted-foreground/80">{formatDate(latestEntryUpdate(entry))}</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5 lg:pl-2">
          <StatusActionSlot available={entry.available} entry={entry} onDeleteEntry={onDeleteEntry} />
          <div className="flex items-center gap-1">
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
                    onClick={() => displayFile && onOpenFolder?.(displayFile)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t.library.openFolder}</TooltipContent>
              </Tooltip>
            ) : onOpenFolder ? (
              <div className="h-8 w-8" />
            ) : null}
            {!isMultiFile && displayFile ? (
              <LibraryFileActions file={displayFile} {...fileActionProps} />
            ) : (
              <div className="h-8 w-8" />
            )}
          </div>
        </div>
      </div>
      {isMultiFile && filesOpen && (
        <div className="mt-3 ml-[68px] flex flex-col border-t border-border/40 pt-2 lg:ml-[72px]">
          {entry.fileRefs.map((file) => (
            <LibraryFileRow file={file} key={file.id} {...fileActionProps} />
          ))}
        </div>
      )}
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

type LibraryFileActionProps = {
  entry: LibraryEntryDto;
  file: LibraryEntryDto["fileRefs"][number];
  onOpenFolder?: LibraryIndexViewProps["onOpenFolder"];
  onRemoveFile?: LibraryIndexViewProps["onRemoveFile"];
  onRelinkFile?: LibraryIndexViewProps["onRelinkFile"];
};

function LibraryFileRow(props: LibraryFileActionProps) {
  const { file } = props;
  const t = useT();
  const statusLabel =
    file.available === null
      ? t.library.fileStatus.unchecked
      : file.available
        ? t.library.fileStatus.available
        : t.library.fileStatus.unavailable;

  return (
    <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto_auto_auto] items-center gap-x-4 rounded-[var(--radius-quiet-sm)] px-2 py-1.5 text-xs transition-colors hover:bg-surface-low">
      <span className="font-mono text-[11px] font-bold text-foreground/50">
        {file.partNumber ? `CD${file.partNumber}` : ""}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-semibold text-foreground/90" title={file.fileName}>
          {file.fileName}
        </span>
        <span className="flex min-w-0 text-[11px]">
          <MiddleEllipsisPath rootDisplayName={file.rootDisplayName} relativePath={file.relativePath} />
        </span>
        {file.availabilityError && <span className="text-destructive">{file.availabilityError}</span>}
      </div>
      <span className="font-numeric text-muted-foreground">{file.resolution ?? ""}</span>
      <span className="font-numeric font-bold text-foreground/80">{formatBytes(file.size)}</span>
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                file.available === null
                  ? "bg-muted-foreground/30"
                  : file.available
                    ? "bg-emerald-500/40"
                    : "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]",
              )}
            />
          </TooltipTrigger>
          <TooltipContent>{statusLabel}</TooltipContent>
        </Tooltip>
        <LibraryFileActions {...props} />
      </div>
    </div>
  );
}

function LibraryFileActions({ entry, file, onOpenFolder, onRemoveFile, onRelinkFile }: LibraryFileActionProps) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const [action, setAction] = useState<"remove" | "relink" | null>(null);
  const [relativePath, setRelativePath] = useState(file.relativePath);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = file.lastKnownPath ?? file.relativePath;
  // Single-file entries already expose "open folder" and "remove" on the card itself.
  const isMultiFile = entry.fileRefs.length > 1;
  const menuItemClass = "h-8 w-full justify-start gap-2 px-2 text-xs font-medium";
  const openDialog = (next: "remove" | "relink") => {
    setMenuOpen(false);
    setError(null);
    setRelativePath(file.relativePath);
    setAction(next);
  };

  return (
    <>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <Button
            aria-label={t.library.fileActions}
            className="h-8 w-8 text-muted-foreground transition-all hover:bg-surface-raised hover:text-foreground"
            size="icon"
            type="button"
            variant="ghost"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="flex w-44 flex-col p-1">
          <Button
            className={menuItemClass}
            onClick={() => {
              setMenuOpen(false);
              copyText(path).then(
                () => toast.success(t.common.pathCopied, { id: "clipboard" }),
                (error: unknown) => toast.error(toErrorMessage(error, t.common.copyPathFailed), { id: "clipboard" }),
              );
            }}
            type="button"
            variant="ghost"
          >
            <Copy className="h-3.5 w-3.5" />
            {t.library.copyPath}
          </Button>
          {isMultiFile && onOpenFolder && file.available !== false && (
            <Button
              className={menuItemClass}
              onClick={() => {
                setMenuOpen(false);
                onOpenFolder(file);
              }}
              type="button"
              variant="ghost"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {t.library.openLocation}
            </Button>
          )}
          {onRelinkFile && (
            <Button className={menuItemClass} onClick={() => openDialog("relink")} type="button" variant="ghost">
              <Link2 className="h-3.5 w-3.5" />
              {t.library.relink}
            </Button>
          )}
          {isMultiFile && onRemoveFile && (
            <Button
              className={cn(menuItemClass, "text-destructive hover:text-destructive")}
              onClick={() => openDialog("remove")}
              type="button"
              variant="ghost"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t.library.removeFile}
            </Button>
          )}
        </PopoverContent>
      </Popover>
      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setAction(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{action === "remove" ? t.library.removeFile : t.library.relinkFileTitle}</DialogTitle>
          </DialogHeader>
          <p className="break-all font-mono text-xs text-muted-foreground">{path}</p>
          {action === "remove" ? (
            <p>{t.library.removeFileDescription}</p>
          ) : (
            <label className="grid gap-2 text-sm" htmlFor={`relink-path-${file.id}`}>
              <span className="text-muted-foreground">{t.library.mediaFolderLabel(file.rootDisplayName)}</span>
              {t.library.newRelativePath}
              <Input
                id={`relink-path-${file.id}`}
                value={relativePath}
                onChange={(event) => setRelativePath(event.target.value)}
              />
            </label>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button disabled={busy} onClick={() => setAction(null)} variant="outline">
              {t.common.cancel}
            </Button>
            <Button
              disabled={busy}
              variant={action === "remove" ? "destructive" : "default"}
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
    </>
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

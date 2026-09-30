import { toErrorMessage } from "@mdcz/shared/error";
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
import { ArrowRight, Check, FolderOpen, ImageIcon, LoaderCircle, Minus, Search } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { ImageOptionCard, type ResolveImageOptionCandidates } from "../../common";
import { type Messages, useT } from "../../i18n";

const LOOKUP_CONCURRENCY = 2;
const TOOL_ICON_BUTTON_CLASS =
  "h-11 w-11 shrink-0 rounded-quiet-sm bg-surface-low text-foreground hover:bg-surface-raised/75";
const TOOL_INPUT_CLASS =
  "h-11 rounded-quiet-sm border-none bg-surface-low/90 px-4 shadow-none focus-visible:ring-2 focus-visible:ring-ring/30";
const TOOL_NOTE_CLASS = "text-xs leading-6 text-muted-foreground";
const TOOL_SECONDARY_BUTTON_CLASS =
  "h-11 rounded-quiet-capsule bg-surface-low px-5 text-sm font-semibold text-foreground hover:bg-surface-raised/75";
const TOOL_SUBSECTION_CLASS = "space-y-4 rounded-quiet-lg bg-surface-low/90 p-4 md:p-5";

type ItemState = {
  scan: AmazonPosterScanItem;
  searchTitle: string;
  lookupSearchTitle: string | null;
  lookup: AmazonPosterLookupResult | null;
  lookupStatus: "pending" | "loading" | "done" | "error";
  selection: "current" | "amazon" | null;
};

export interface AmazonPosterApplyItem {
  amazonPosterUrl: string;
  nfoPath: string;
}

export interface AmazonPosterImageOptionProps {
  baseDir?: string;
  defaultAspectRatio?: number;
  empty?: boolean;
  emptyText?: string;
  fallbackSrcs?: string[];
  imageFrameClassName?: string;
  label: string;
  layout?: "inline" | "stacked";
  loading?: boolean;
  metadataClassName?: string;
  onClick?: () => void;
  resolveImageCandidates?: ResolveImageOptionCandidates;
  selected?: boolean;
  showDimensions?: boolean;
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
  resolveImageCandidates?: ResolveImageOptionCandidates;
  showError?: (message: string) => void;
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

function getStatusBadge(
  state: ItemState,
  t: Messages,
): {
  label: string;
  variant: "default" | "secondary" | "outline" | "destructive";
  icon: ComponentType<{ className?: string }>;
} {
  if (state.lookupStatus === "pending") {
    return { label: t.tools.statusPendingQuery, variant: "secondary", icon: Search };
  }

  if (state.lookupStatus === "loading") {
    return { label: t.tools.statusQuerying, variant: "secondary", icon: LoaderCircle };
  }
  if (state.lookupStatus === "error") return { label: t.tools.statusQueryFailed, variant: "destructive", icon: Minus };
  if (!state.lookup?.amazonPosterUrl) return { label: t.tools.statusNoResults, variant: "outline", icon: Minus };
  if (state.selection === "current") return { label: t.tools.statusKeepCurrent, variant: "outline", icon: Check };
  return { label: "✓ Amazon", variant: "default", icon: Check };
}

function DefaultSummaryThumb({
  empty = false,
  loading = false,
  resolveImageCandidates,
  src,
}: {
  empty?: boolean;
  loading?: boolean;
  resolveImageCandidates?: ResolveImageOptionCandidates;
  src?: string | null;
}) {
  const [resolvedSrc, setResolvedSrc] = useState("");

  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      const [nextSrc = ""] = await (resolveImageCandidates?.(src ? [src] : []) ?? Promise.resolve(src ? [src] : []));
      if (!cancelled) {
        setResolvedSrc(nextSrc);
      }
    };

    void resolve();

    return () => {
      cancelled = true;
    };
  }, [resolveImageCandidates, src]);

  if (loading) return <div className="h-[22px] w-8 animate-pulse rounded-md bg-muted/50" />;
  if (empty || !resolvedSrc) {
    return (
      <div className="flex h-[22px] w-8 items-center justify-center rounded-md border border-dashed border-muted-foreground/30 bg-muted/20">
        <ImageIcon className="h-3.5 w-3.5 text-muted-foreground/50" />
      </div>
    );
  }
  return <img src={resolvedSrc} alt="thumbnail" className="h-[22px] w-8 rounded-md border bg-muted/20 object-cover" />;
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
  resolveImageCandidates,
  showError,
}: AmazonPosterWorkspaceDetailProps) {
  const [directory, setDirectory] = useState("");
  const [itemStates, setItemStates] = useState<ItemState[]>([]);
  const t = useT();
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);
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
      searchTitle: scan.searchTitle,
      lookupSearchTitle: null,
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

        const queryTitle = items[currentIndex].searchTitle.trim();
        let result: AmazonPosterLookupResult;
        try {
          result = await onLookup({ ...items[currentIndex], searchTitle: queryTitle });
        } catch (error) {
          result = {
            nfoPath: items[currentIndex].nfoPath,
            amazonPosterUrl: null,
            reason: "query_failed",
            error: toErrorMessage(error),
            elapsedMs: 0,
          };
        }

        if (cancelled) return;

        updateItem(currentIndex, (state) => ({
          ...state,
          lookupSearchTitle: queryTitle,
          lookup: result,
          lookupStatus: result.reason === "query_failed" ? "error" : "done",
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
  const ImageOption = renderImageOption ?? ((props: AmazonPosterImageOptionProps) => <ImageOptionCard {...props} />);

  const browseDirectory = async () => {
    const selected = await onBrowseDirectory?.();
    if (selected) setDirectory(selected);
  };

  const handleSelectionChange = (index: number, selection: "current" | "amazon") => {
    setItemStates((prev) => prev.map((state, stateIndex) => (stateIndex === index ? { ...state, selection } : state)));
  };

  const handleSearchTitleChange = (index: number, searchTitle: string) => {
    setItemStates((prev) =>
      prev.map((state, stateIndex) =>
        stateIndex === index
          ? {
              ...state,
              searchTitle,
              lookup: state.lookupSearchTitle === searchTitle.trim() ? state.lookup : null,
              lookupStatus: state.lookupSearchTitle === searchTitle.trim() ? state.lookupStatus : "pending",
              selection: state.lookupSearchTitle === searchTitle.trim() ? state.selection : null,
            }
          : state,
      ),
    );
  };

  const handleLookup = async (index: number) => {
    const target = itemStates[index];
    const queryTitle = target?.searchTitle.trim();
    if (!target || !queryTitle) {
      showError?.(t.tools.enterSearchQuery);
      return;
    }

    setItemStates((prev) =>
      prev.map((state, stateIndex) =>
        stateIndex === index ? { ...state, lookupStatus: "loading", lookup: null, selection: null } : state,
      ),
    );

    let result: AmazonPosterLookupResult;
    try {
      result = await onLookup({ ...target.scan, searchTitle: queryTitle });
    } catch (error) {
      result = {
        nfoPath: target.scan.nfoPath,
        amazonPosterUrl: null,
        reason: "query_failed",
        error: toErrorMessage(error),
        elapsedMs: 0,
      };
    }

    setItemStates((prev) =>
      prev.map((state, stateIndex) =>
        stateIndex === index
          ? {
              ...state,
              lookupSearchTitle: queryTitle,
              lookup: result,
              lookupStatus: result.reason === "query_failed" ? "error" : "done",
              selection: result.amazonPosterUrl ? "amazon" : null,
            }
          : state,
      ),
    );
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
    <div className="space-y-6">
      <div className={TOOL_SUBSECTION_CLASS}>
        <Label
          htmlFor="amazon-poster-dir"
          className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
        >
          {t.tools.targetDirectory}
        </Label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            id="amazon-poster-dir"
            value={directory}
            onChange={(event) => setDirectory(event.target.value)}
            placeholder={t.tools.targetDirectoryPlaceholder}
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
        <p className={TOOL_NOTE_CLASS}>{t.tools.amazonPosterScanNote}</p>
      </div>

      <Button
        variant="secondary"
        onClick={() => void onScan(directory)}
        disabled={scanning}
        className={cn(TOOL_SECONDARY_BUTTON_CLASS, "w-full sm:w-auto")}
      >
        {scanning ? t.tools.scanning : t.tools.startScan}
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
                  <DialogTitle>{t.tools.amazonPosterEnhance}</DialogTitle>
                  <DialogDescription>
                    {t.tools.amazonProgress({ completed: completedCount, total: itemStates.length, hits: hitCount })}
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
                  {t.tools.noNfoEntries}
                </div>
              ) : (
                itemStates.map((state, index) => {
                  const isExpanded = index === expandedIndex;
                  const statusBadge = getStatusBadge(state, t);
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
                        onClick={() => setExpandedIndex((current) => (current === index ? null : index))}
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
                              resolveImageCandidates={resolveImageCandidates}
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
                              resolveImageCandidates={resolveImageCandidates}
                            />
                          )}
                          <Badge variant={statusBadge.variant} className="h-6 gap-1 rounded-full px-2">
                            <StatusIcon className={cn("h-3 w-3", state.lookupStatus === "loading" && "animate-spin")} />
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
                                {t.tools.elapsed(formatElapsed(state.lookup?.elapsedMs))}
                              </div>
                            </div>

                            <div className="space-y-2">
                              <Label
                                htmlFor={`amazon-search-title-${index}`}
                                className="text-xs font-medium text-muted-foreground"
                              >
                                {t.tools.titleUrlOrAsin}
                              </Label>
                              <div className="flex flex-col gap-2 sm:flex-row">
                                <Input
                                  id={`amazon-search-title-${index}`}
                                  value={state.searchTitle}
                                  onChange={(event) => handleSearchTitleChange(index, event.target.value)}
                                  disabled={state.lookupStatus === "loading"}
                                  className="min-w-0 flex-1"
                                />
                                <Button
                                  type="button"
                                  variant="secondary"
                                  onClick={() => void handleLookup(index)}
                                  disabled={!state.searchTitle.trim() || state.lookupStatus === "loading"}
                                  className="gap-2"
                                >
                                  {state.lookupStatus === "loading" ? (
                                    <LoaderCircle className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Search className="h-4 w-4" />
                                  )}
                                  {t.tools.reQuery}
                                </Button>
                              </div>
                            </div>

                            <div className="grid gap-3 md:grid-cols-2">
                              <ImageOption
                                layout="inline"
                                defaultAspectRatio={2 / 3}
                                src={state.scan.currentPosterPath ?? ""}
                                resolveImageCandidates={resolveImageCandidates}
                                label={t.tools.currentPoster}
                                width={state.scan.currentPosterWidth || null}
                                height={state.scan.currentPosterHeight || null}
                                imageFrameClassName="max-w-48"
                                metadataClassName="max-w-48"
                                showDimensions
                                subtitle={getFileNameFromPath(state.scan.currentPosterPath)}
                                selected={state.selection === "current"}
                                onClick={
                                  state.scan.currentPosterPath
                                    ? () => handleSelectionChange(index, "current")
                                    : undefined
                                }
                                empty={!state.scan.currentPosterPath}
                                emptyText={t.tools.noCurrentPoster}
                              />

                              <ImageOption
                                layout="inline"
                                defaultAspectRatio={2 / 3}
                                src={state.lookup?.amazonPosterUrl ?? ""}
                                resolveImageCandidates={resolveImageCandidates}
                                label={t.tools.amazonPoster}
                                imageFrameClassName="max-w-48"
                                metadataClassName="max-w-48"
                                showDimensions
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
                                  thumbnailLoading
                                    ? t.tools.queryingAmazon
                                    : state.lookup
                                      ? [t.tools.amazonLookupReasons[state.lookup.reason], state.lookup.error]
                                          .filter(Boolean)
                                          .join(": ")
                                      : t.tools.noAmazonPosterHit
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
            <div className="text-sm text-muted-foreground">
              {t.tools.selectedForReplace(selectedAmazonItems.length)}
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => onDialogOpenChange(false)}>
                {t.common.cancel}
              </Button>
              <Button
                type="button"
                onClick={() => setConfirmOpen(true)}
                disabled={selectedAmazonItems.length === 0 || applying}
              >
                {t.tools.confirmReplace}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.tools.confirmReplaceTitle}</DialogTitle>
            <DialogDescription>{t.tools.confirmReplaceDescription(selectedAmazonItems.length)}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)} disabled={applying}>
              {t.common.cancel}
            </Button>
            <Button
              type="button"
              onClick={() => void handleApply()}
              disabled={selectedAmazonItems.length === 0 || applying}
            >
              {applying ? t.tools.replacing : t.common.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

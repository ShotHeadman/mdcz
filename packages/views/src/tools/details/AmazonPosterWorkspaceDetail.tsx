import { toErrorMessage } from "@mdcz/shared/error";
import { type NormalizedCropRegion, resolveInitialPosterCrop } from "@mdcz/shared/posterCrop";
import type {
  AmazonPosterApplyItem,
  AmazonPosterApplyResultItem,
  AmazonPosterLookupResult,
  AmazonPosterScanItem,
} from "@mdcz/shared/toolTypes";
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
import { ArrowRight, Check, Crop, FolderOpen, ImageIcon, LoaderCircle, Minus, Search } from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  ImageOptionCard,
  PosterCropDialog,
  type PosterCropEditSession,
  type ResolveImageOptionCandidates,
} from "../../common";
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

/** The found image's size as the browser loaded it, and the 2:3 area of it the poster is cut to. */
type AmazonCut = { width: number; height: number; crop: NormalizedCropRegion };

type ItemState = {
  scan: AmazonPosterScanItem;
  searchTitle: string;
  lookupSearchTitle: string | null;
  lookup: AmazonPosterLookupResult | null;
  cut: AmazonCut | null;
  lookupStatus: "pending" | "loading" | "done" | "error";
  selection: "current" | "amazon" | null;
  applyError: string | null;
};

export interface AmazonPosterWorkspaceDetailProps {
  onApply: (items: AmazonPosterApplyItem[]) => Promise<AmazonPosterApplyResultItem[]>;
  onBrowseDirectory?: () => Promise<string | null | undefined>;
  onLookup: (item: AmazonPosterScanItem, title: string) => Promise<AmazonPosterLookupResult>;
  onScan: (directory: string) => Promise<AmazonPosterScanItem[]>;
  resolveImageCandidates?: ResolveImageOptionCandidates;
  /** The directory Brief opened the tool with; each new key fills it in once. */
  prefill?: { key: string; directory?: string };
}

const measureImage = (src: string) =>
  new Promise<{ width: number; height: number } | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve(null);
    image.src = src;
  });

/**
 * Looks the movie up and cuts what it finds: by the area the poster was last cut by when it came from the same image,
 * otherwise by the starting area of the crop dialog. An area is never carried from one movie's image to another's.
 */
async function lookupWithCut(
  scan: AmazonPosterScanItem,
  title: string,
  onLookup: AmazonPosterWorkspaceDetailProps["onLookup"],
): Promise<{ lookup: AmazonPosterLookupResult; cut: AmazonCut | null }> {
  let lookup: AmazonPosterLookupResult;
  try {
    lookup = await onLookup(scan, title);
  } catch (error) {
    lookup = {
      nfoPath: scan.nfoPath,
      amazonPosterUrl: null,
      reason: "query_failed",
      error: toErrorMessage(error),
      elapsedMs: 0,
    };
  }
  const url = lookup.amazonPosterUrl;
  if (!url) return { lookup, cut: null };
  const size = await measureImage(url);
  if (!size) return { lookup: { ...lookup, amazonPosterUrl: null, reason: "image_unreachable" }, cut: null };
  return { lookup, cut: { ...size, crop: resolveInitialPosterCrop(scan.posterCut, url, size.width, size.height) } };
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
  if (state.applyError !== null) return { label: t.tools.statusReplaceFailed, variant: "destructive", icon: Minus };
  if (!state.lookup?.amazonPosterUrl) return { label: t.tools.statusNoResults, variant: "outline", icon: Minus };
  if (state.selection === "current") return { label: t.tools.statusKeepCurrent, variant: "outline", icon: Check };
  return { label: "✓ Amazon", variant: "default", icon: Check };
}

function SummaryThumb({
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
  onApply,
  onBrowseDirectory,
  onLookup,
  onScan,
  resolveImageCandidates,
  prefill,
}: AmazonPosterWorkspaceDetailProps) {
  const [directory, setDirectory] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [items, setItems] = useState<AmazonPosterScanItem[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [itemStates, setItemStates] = useState<ItemState[]>([]);
  const t = useT();
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [cropping, setCropping] = useState<{
    filePath: string;
    session: PosterCropEditSession;
    crop: NormalizedCropRegion;
  } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  // Replacements accumulate across retries of the same scan; failures count only the latest attempt.
  const [applyOutcome, setApplyOutcome] = useState<{ replaced: number; failed: number } | null>(null);
  // A review already open keeps its directory; the tool stays mounted while the user is elsewhere.
  const [prefillKey, setPrefillKey] = useState<string>();
  if (prefill && prefill.key !== prefillKey && !dialogOpen && !applying) {
    setPrefillKey(prefill.key);
    if (prefill.directory) setDirectory(prefill.directory);
  }

  useEffect(() => {
    if (!dialogOpen) {
      setItemStates([]);
      setExpandedPath(null);
      setConfirmOpen(false);
      setApplying(false);
      return;
    }

    const initialStates = items.map((scan) => ({
      scan,
      searchTitle: scan.title,
      lookupSearchTitle: null,
      lookup: null,
      cut: null,
      lookupStatus: "pending" as const,
      selection: null,
      applyError: null,
    }));

    setItemStates(initialStates);
    setExpandedPath(items[0]?.filePath ?? null);
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

        const queryTitle = items[currentIndex].title.trim();
        const { lookup, cut } = await lookupWithCut(items[currentIndex], queryTitle, onLookup);

        if (cancelled) return;

        updateItem(currentIndex, (state) => ({
          ...state,
          lookupSearchTitle: queryTitle,
          lookup,
          cut,
          lookupStatus: lookup.reason === "query_failed" ? "error" : "done",
          selection: cut ? (state.selection === "current" ? "current" : "amazon") : state.selection,
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
      itemStates.flatMap((state) =>
        state.selection === "amazon" && state.lookup?.amazonPosterUrl && state.cut
          ? [{ filePath: state.scan.filePath, amazonPosterUrl: state.lookup.amazonPosterUrl, crop: state.cut.crop }]
          : [],
      ),
    [itemStates],
  );
  const progressValue = itemStates.length > 0 ? Math.round((completedCount / itemStates.length) * 100) : 0;

  const browseDirectory = async () => {
    const selected = await onBrowseDirectory?.();
    if (selected) setDirectory(selected);
  };

  const handleScan = async () => {
    setScanning(true);
    setScanError(null);
    setApplyOutcome(null);
    try {
      setItems(await onScan(directory.trim()));
      setDialogOpen(true);
    } catch (error) {
      setScanError(toErrorMessage(error));
    } finally {
      setScanning(false);
    }
  };

  const handleSelectionChange = (index: number, selection: "current" | "amazon") => {
    setItemStates((prev) =>
      prev.map((state, stateIndex) => (stateIndex === index ? { ...state, selection, applyError: null } : state)),
    );
  };

  const handleSearchTitleChange = (index: number, searchTitle: string) => {
    setItemStates((prev) =>
      prev.map((state, stateIndex) =>
        stateIndex === index
          ? {
              ...state,
              searchTitle,
              lookup: state.lookupSearchTitle === searchTitle.trim() ? state.lookup : null,
              cut: state.lookupSearchTitle === searchTitle.trim() ? state.cut : null,
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
    if (!target || !queryTitle) return;

    setItemStates((prev) =>
      prev.map((state, stateIndex) =>
        stateIndex === index
          ? { ...state, lookupStatus: "loading", lookup: null, cut: null, selection: null, applyError: null }
          : state,
      ),
    );

    const { lookup, cut } = await lookupWithCut(target.scan, queryTitle, onLookup);

    setItemStates((prev) =>
      prev.map((state, stateIndex) =>
        stateIndex === index
          ? {
              ...state,
              lookupSearchTitle: queryTitle,
              lookup,
              cut,
              lookupStatus: lookup.reason === "query_failed" ? "error" : "done",
              selection: cut ? "amazon" : null,
            }
          : state,
      ),
    );
  };

  const handleApply = async () => {
    setApplying(true);
    const replacedPaths = new Set<string>();
    const errorByPath = new Map<string, string>();
    try {
      for (const result of await onApply(selectedAmazonItems)) {
        if (result.success) replacedPaths.add(result.filePath);
        else errorByPath.set(result.filePath, result.error ?? "");
      }
    } catch (error) {
      for (const item of selectedAmazonItems) errorByPath.set(item.filePath, toErrorMessage(error));
    }
    setApplying(false);
    setConfirmOpen(false);
    setApplyOutcome((previous) => ({
      replaced: (previous?.replaced ?? 0) + replacedPaths.size,
      failed: errorByPath.size,
    }));
    if (errorByPath.size === 0) {
      setDialogOpen(false);
      return;
    }
    // Replaced items leave the list; failed ones stay selected so confirming again retries just them.
    setItemStates((prev) =>
      prev
        .filter((state) => !replacedPaths.has(state.scan.filePath))
        .map((state) => ({ ...state, applyError: errorByPath.get(state.scan.filePath) ?? null })),
    );
    setExpandedPath(selectedAmazonItems.find((item) => errorByPath.has(item.filePath))?.filePath ?? null);
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
        onClick={() => void handleScan()}
        disabled={scanning || !directory.trim()}
        className={cn(TOOL_SECONDARY_BUTTON_CLASS, "w-full sm:w-auto")}
      >
        {scanning ? t.tools.scanning : t.tools.startScan}
      </Button>
      {scanError ? <p className="break-all text-sm text-destructive">{scanError}</p> : null}
      {applyOutcome && !dialogOpen ? (
        <p className={cn("text-sm", applyOutcome.failed > 0 ? "text-destructive" : "text-muted-foreground")}>
          {t.tools.replaceOutcome(applyOutcome)}
        </p>
      ) : null}

      <Dialog
        open={dialogOpen}
        onOpenChange={(nextOpen) => {
          setConfirmOpen(false);
          setDialogOpen(nextOpen);
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
                  const isExpanded = state.scan.filePath === expandedPath;
                  const statusBadge = getStatusBadge(state, t);
                  const StatusIcon = statusBadge.icon;
                  const thumbnailLoading = state.lookupStatus === "loading" || state.lookupStatus === "pending";
                  const amazonEmpty = !thumbnailLoading && !state.lookup?.amazonPosterUrl;

                  return (
                    <div
                      key={state.scan.filePath}
                      className={cn(
                        "overflow-hidden rounded-xl border bg-card transition-all duration-300",
                        isExpanded ? "border-primary/30 shadow-sm" : "border-border/60",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedPath((current) => (current === state.scan.filePath ? null : state.scan.filePath))
                        }
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
                          <SummaryThumb
                            src={state.scan.currentPosterPath}
                            empty={!state.scan.currentPosterPath}
                            resolveImageCandidates={resolveImageCandidates}
                          />
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                          <SummaryThumb
                            src={state.lookup?.amazonPosterUrl}
                            loading={thumbnailLoading}
                            empty={amazonEmpty}
                            resolveImageCandidates={resolveImageCandidates}
                          />
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

                            {state.applyError ? (
                              <p className="break-all text-sm text-destructive">{state.applyError}</p>
                            ) : null}

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
                              <ImageOptionCard
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

                              <ImageOptionCard
                                layout="inline"
                                defaultAspectRatio={2 / 3}
                                src={state.lookup?.amazonPosterUrl ?? ""}
                                resolveImageCandidates={resolveImageCandidates}
                                crop={state.cut?.crop}
                                width={state.cut ? Math.round(state.cut.crop.width * state.cut.width) : null}
                                height={state.cut ? Math.round(state.cut.crop.height * state.cut.height) : null}
                                label={t.tools.amazonPoster}
                                imageFrameClassName="max-w-48"
                                metadataClassName="max-w-48"
                                showDimensions
                                subtitle={state.lookup?.amazonPosterUrl ? "Amazon.co.jp" : undefined}
                                selected={state.selection === "amazon"}
                                onClick={state.cut ? () => handleSelectionChange(index, "amazon") : undefined}
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
                            {state.cut ? (
                              <div className="flex justify-end">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  className="gap-2"
                                  onClick={() => {
                                    const { cut } = state;
                                    const sourceUrl = state.lookup?.amazonPosterUrl;
                                    if (!cut || !sourceUrl) return;
                                    setCropping({
                                      filePath: state.scan.filePath,
                                      session: {
                                        sourceUrl,
                                        width: cut.width,
                                        height: cut.height,
                                        initialCrop: cut.crop,
                                      },
                                      crop: cut.crop,
                                    });
                                  }}
                                >
                                  <Crop className="h-4 w-4" />
                                  {t.tools.adjustAmazonCrop}
                                </Button>
                              </div>
                            ) : null}
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
              {applyOutcome ? <p className="text-destructive">{t.tools.replaceOutcome(applyOutcome)}</p> : null}
              <p>{t.tools.selectedForReplace(selectedAmazonItems.length)}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
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

      <PosterCropDialog
        open={cropping !== null}
        session={cropping?.session ?? null}
        crop={cropping?.crop ?? null}
        saving={false}
        confirmLabel={t.common.confirm}
        onCropChange={(crop) => setCropping((current) => current && { ...current, crop })}
        onOpenChange={(open) => {
          if (!open) setCropping(null);
        }}
        onSave={() => {
          if (!cropping) return;
          setItemStates((prev) =>
            prev.map((state) =>
              state.scan.filePath === cropping.filePath && state.cut
                ? { ...state, cut: { ...state.cut, crop: cropping.crop }, selection: "amazon", applyError: null }
                : state,
            ),
          );
          setCropping(null);
        }}
      />
    </div>
  );
}

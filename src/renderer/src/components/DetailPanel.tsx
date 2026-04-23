import type { FieldDiff, LocalScanEntry, MaintenanceItemResult, MaintenancePreviewItem } from "@shared/types";
import { FileText, FolderOpen, GitCompareArrows, ImageIcon, MousePointerClick, Play, Star, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  formatBitrate,
  formatDuration,
  toDetailViewItemFromScrapeResult,
} from "@/components/detail/detailViewAdapters";
import type { DetailViewItem } from "@/components/detail/types";
import { useDetailViewController } from "@/components/detail/useDetailViewController";
import ChangeDiffView from "@/components/maintenance/ChangeDiffView";
import PathPlanView from "@/components/maintenance/PathPlanView";
import { SceneImageGallery } from "@/components/SceneImageGallery";
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
import { ScrollArea } from "@/components/ui/ScrollArea";
import type { MaintenanceFieldSelectionSide } from "@/lib/maintenance";
import { findScrapeResultGroup } from "@/lib/scrapeResultGrouping";
import { useScrapeStore } from "@/store/scrapeStore";
import { useUIStore } from "@/store/uiStore";
import { getDirFromPath } from "@/utils/path";

const EMPTY_RESULTS: ReturnType<typeof useScrapeStore.getState>["results"] = [];

interface DetailPanelCompareProps {
  result?: MaintenanceItemResult | MaintenancePreviewItem;
  badgeLabel?: string;
  titleOverride?: string;
  entry?: LocalScanEntry;
  preview?: MaintenancePreviewItem;
  fieldSelections?: Record<string, MaintenanceFieldSelectionSide>;
  onFieldSelectionChange?: (fileId: string, field: FieldDiff["field"], side: MaintenanceFieldSelectionSide) => void;
}

interface DetailPanelProps {
  item?: DetailViewItem | null;
  emptyMessage?: string;
  compare?: DetailPanelCompareProps;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center select-none">
      <MousePointerClick className="h-10 w-10 text-muted-foreground/30" strokeWidth={1.25} />
      <span className="max-w-sm text-sm text-muted-foreground/60">{message}</span>
    </div>
  );
}

function DetailPathBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-quiet bg-surface-low/70 p-4">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="break-all font-mono text-[11px] leading-relaxed text-foreground/75">{value}</div>
    </div>
  );
}

function DetailErrorBlock({ value }: { value: string }) {
  return (
    <div className="rounded-quiet bg-red-50/70 p-4 dark:bg-red-950/20">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-destructive/80">错误详情</div>
      <div className="text-sm leading-relaxed text-destructive">{value}</div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="text-[15px] leading-6 text-foreground">{value}</div>
    </div>
  );
}

function DetailSectionTitle({ children }: { children: string }) {
  return <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground/80">{children}</div>;
}

interface DetailActionButtonsProps {
  nfoLoading: boolean;
  onPlay: () => void;
  onOpenFolder: () => void;
  onOpenNfo: () => void;
}

function DetailActionButtons({ nfoLoading, onPlay, onOpenFolder, onOpenNfo }: DetailActionButtonsProps) {
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="rounded-quiet-capsule bg-surface-low/75 px-3.5 text-foreground/80 hover:bg-surface-low"
        onClick={onPlay}
      >
        <Play className="h-4 w-4" />
        播放
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="rounded-quiet-capsule bg-surface-low/75 px-3.5 text-foreground/80 hover:bg-surface-low"
        onClick={onOpenFolder}
      >
        <FolderOpen className="h-4 w-4" />
        打开文件夹
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="rounded-quiet-capsule bg-surface-low/75 px-3.5 text-foreground/80 hover:bg-surface-low"
        onClick={onOpenNfo}
        disabled={nfoLoading}
      >
        <FileText className="h-4 w-4" />
        编辑 NFO
      </Button>
    </>
  );
}

export function DetailPanel({
  item: explicitItem,
  emptyMessage = "请选择一个项目以查看详情",
  compare,
}: DetailPanelProps = {}) {
  const results = useScrapeStore((state) => (explicitItem === undefined ? state.results : EMPTY_RESULTS));
  const selectedResultId = useUIStore((state) => (explicitItem === undefined ? state.selectedResultId : null));

  const item = useMemo(
    () =>
      explicitItem !== undefined
        ? explicitItem
        : (() => {
            const selectedGroup = findScrapeResultGroup(results, selectedResultId);
            return selectedGroup ? toDetailViewItemFromScrapeResult(selectedGroup.display) : null;
          })(),
    [explicitItem, results, selectedResultId],
  );

  const compareMode = Boolean(compare);
  const [thumbPreviewOpen, setThumbPreviewOpen] = useState(false);
  const {
    posterSrc,
    thumbSrc,
    nfoOpen,
    nfoContent,
    nfoLoading,
    nfoSaving,
    setNfoOpen,
    setNfoContent,
    handlePlay,
    handleOpenFolder,
    handleOpenNfo,
    handlePosterError,
    handleThumbError,
    handleSaveNfo,
  } = useDetailViewController(compareMode ? null : item);

  if (!item) {
    return <EmptyState message={emptyMessage} />;
  }

  if (compareMode) {
    const compareError = compare?.result?.error ?? (!compare?.result ? item.errorMessage : undefined);
    const hasComparedResult = Boolean(compare?.result);
    const shouldRenderDiffs = hasComparedResult || !compareError;

    return (
      <div className="flex h-full flex-col overflow-hidden bg-gradient-to-b from-surface-canvas via-surface-canvas to-surface-low/30">
        <div className="shrink-0 px-5 py-4 md:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">数据对比</div>
              <h2 className="mt-2 text-xl font-extrabold tracking-tight text-foreground">{item.number}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {compare?.titleOverride ?? item.title ?? item.number}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
              <Badge variant="outline" className="gap-1 self-start rounded-full px-2.5 py-1 text-xs sm:self-auto">
                <GitCompareArrows className="h-3.5 w-3.5" />
                {compare?.badgeLabel ?? "数据对比"}
              </Badge>
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="flex min-h-full flex-col space-y-4 px-5 pb-24 md:px-6">
            {compareError && item.path && <DetailPathBlock label="文件路径" value={item.path} />}

            {compareError && <DetailErrorBlock value={compareError} />}

            {shouldRenderDiffs && (
              <ChangeDiffView
                fileId={item.id}
                diffs={compare?.result?.fieldDiffs ?? []}
                unchangedDiffs={compare?.result?.unchangedFieldDiffs ?? []}
                hasResult={hasComparedResult}
                entry={compare?.entry}
                preview={compare?.preview}
                fieldSelections={compare?.fieldSelections}
                onFieldSelectionChange={compare?.onFieldSelectionChange}
              />
            )}

            {compare?.result?.pathDiff && <PathPlanView pathDiff={compare.result.pathDiff} />}
          </div>
        </ScrollArea>
      </div>
    );
  }

  const durationLabel = formatDuration(item.durationSeconds);
  const bitrateLabel = formatBitrate(item.bitrate);
  const ratingLabel = typeof item.rating === "number" ? String(item.rating) : undefined;
  const titleLabel = item.title?.trim() || item.number;
  const topMetaNumber = item.title?.trim() ? item.number : undefined;
  const posterAlt = item.title?.trim() || item.number;
  const metadataLeftColumn = [
    item.actors && item.actors.length > 0 ? { label: "演员", value: item.actors.join(", ") } : undefined,
    item.studio ? { label: "制片", value: item.studio } : undefined,
    item.releaseDate ? { label: "发行日期", value: item.releaseDate } : undefined,
    item.series ? { label: "系列", value: item.series } : undefined,
  ].filter((field): field is { label: string; value: string } => Boolean(field?.value));
  const metadataRightColumn = [
    item.director ? { label: "导演", value: item.director } : undefined,
    item.genres && item.genres.length > 0 ? { label: "标签", value: item.genres.join(", ") } : undefined,
  ].filter((field): field is { label: string; value: string } => Boolean(field?.value));
  const technicalFields = [
    item.resolution ? { label: "分辨率", value: item.resolution } : undefined,
    bitrateLabel ? { label: "码率", value: bitrateLabel } : undefined,
  ].filter((field): field is { label: string; value: string } => Boolean(field?.value));
  const supportingFields = [
    durationLabel ? { label: "时长", value: durationLabel } : undefined,
    item.publisher ? { label: "发行商", value: item.publisher } : undefined,
  ].filter((field): field is { label: string; value: string } => Boolean(field?.value));
  const shouldShowThumb = Boolean(thumbSrc) && thumbSrc !== posterSrc;

  return (
    <>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-b from-surface-canvas via-surface-canvas to-surface-low/30">
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-6 px-5 py-5 pb-24 md:px-6 md:py-6 md:pb-28 lg:px-8 xl:px-12">
            {item.minimalErrorView ? (
              <>
                <div className="space-y-3">
                  <DetailSectionTitle>详情</DetailSectionTitle>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-3xl font-extrabold tracking-tight text-foreground">{titleLabel}</h2>
                    <div className="flex flex-wrap gap-2">
                      <DetailActionButtons
                        nfoLoading={nfoLoading}
                        onPlay={handlePlay}
                        onOpenFolder={handleOpenFolder}
                        onOpenNfo={handleOpenNfo}
                      />
                    </div>
                  </div>
                </div>
                {item.path && <DetailPathBlock label="文件路径" value={item.path} />}
                {item.errorMessage && <DetailErrorBlock value={item.errorMessage} />}
              </>
            ) : (
              <>
                <section className="grid gap-6 min-[960px]:grid-cols-[minmax(0,180px)_minmax(0,1fr)] min-[960px]:items-start">
                  <div className="w-full max-w-[180px] shrink-0">
                    {posterSrc ? (
                      <div className="relative aspect-2/3 overflow-hidden rounded-quiet-lg border border-black/5 bg-surface-low/70 shadow-[0_18px_48px_rgba(0,0,0,0.08)]">
                        <img
                          src={posterSrc}
                          alt={posterAlt}
                          className="h-full w-full object-cover"
                          onError={handlePosterError}
                        />
                      </div>
                    ) : (
                      <div className="flex aspect-2/3 w-full items-center justify-center rounded-quiet-lg border border-black/5 bg-surface-low/70">
                        <ImageIcon className="h-10 w-10 text-muted-foreground/30" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
                        <h2 className="max-w-3xl text-3xl font-extrabold leading-none tracking-tight text-foreground md:text-4xl">
                          {titleLabel}
                        </h2>
                        {topMetaNumber && (
                          <span className="font-numeric text-xl text-muted-foreground/80">{topMetaNumber}</span>
                        )}
                        {ratingLabel && (
                          <span className="inline-flex items-center gap-1.5 font-numeric text-base font-semibold text-foreground">
                            <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                            {ratingLabel}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <DetailActionButtons
                          nfoLoading={nfoLoading}
                          onPlay={handlePlay}
                          onOpenFolder={handleOpenFolder}
                          onOpenNfo={handleOpenNfo}
                        />
                      </div>
                    </div>

                    <div className="mt-5 border-t border-black/5 pt-5">
                      <div className="grid gap-x-8 gap-y-6 min-[900px]:grid-cols-2">
                        <div className="space-y-6">
                          {metadataLeftColumn.map((field) => (
                            <DetailField key={field.label} label={field.label} value={field.value} />
                          ))}
                        </div>

                        <div className="space-y-6">
                          {metadataRightColumn.map((field) => (
                            <DetailField key={field.label} label={field.label} value={field.value} />
                          ))}

                          {technicalFields.length > 0 && (
                            <div className="grid gap-4 sm:grid-cols-2">
                              {technicalFields.map((field) => (
                                <DetailField key={field.label} label={field.label} value={field.value} />
                              ))}
                            </div>
                          )}

                          {supportingFields.length > 0 && (
                            <div className="grid gap-4 sm:grid-cols-2">
                              {supportingFields.map((field) => (
                                <DetailField key={field.label} label={field.label} value={field.value} />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {item.plot && (
                  <section className="space-y-3">
                    <DetailSectionTitle>内容简介</DetailSectionTitle>
                    <p className="max-w-4xl whitespace-pre-wrap text-[15px] leading-7 text-foreground/88">
                      {item.plot}
                    </p>
                  </section>
                )}

                {shouldShowThumb && (
                  <section className="space-y-3">
                    <DetailSectionTitle>缩略图</DetailSectionTitle>
                    <button
                      type="button"
                      className="inline-flex max-w-full cursor-zoom-in overflow-hidden rounded-quiet-sm transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                      onClick={() => setThumbPreviewOpen(true)}
                    >
                      <img
                        src={thumbSrc}
                        alt={`${posterAlt} 缩略图`}
                        className="block max-h-100 max-w-full rounded-quiet-sm object-contain"
                        onError={handleThumbError}
                      />
                    </button>
                  </section>
                )}

                {item.sceneImages && item.sceneImages.length > 0 && (
                  <section className="space-y-3">
                    <SceneImageGallery
                      images={item.sceneImages}
                      baseDir={item.outputPath ?? (item.path ? getDirFromPath(item.path) : undefined)}
                      label="剧照"
                      variant="filmstrip"
                    />
                  </section>
                )}

                {item.path && <DetailPathBlock label="文件路径" value={item.path} />}

                {item.errorMessage && <DetailErrorBlock value={item.errorMessage} />}
              </>
            )}
          </div>
        </ScrollArea>
      </div>

      <Dialog open={nfoOpen} onOpenChange={setNfoOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>编辑 NFO 文件</DialogTitle>
          </DialogHeader>
          <textarea
            value={nfoContent}
            onChange={(event) => setNfoContent(event.target.value)}
            className="h-[60vh] w-full resize-none rounded-md border bg-background p-3 font-mono text-[11px]"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNfoOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSaveNfo} disabled={nfoSaving}>
              保存修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={thumbPreviewOpen} onOpenChange={setThumbPreviewOpen}>
        <DialogContent
          showCloseButton={false}
          className="max-h-[90vh] max-w-[90vw] overflow-hidden border-0 bg-black/95 p-0"
        >
          <DialogTitle className="sr-only">缩略图预览</DialogTitle>
          <DialogDescription className="sr-only">查看当前缩略图的大图预览。</DialogDescription>
          <button
            type="button"
            onClick={() => setThumbPreviewOpen(false)}
            className="absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex h-[80vh] w-full items-center justify-center p-4">
            {shouldShowThumb ? (
              <img
                src={thumbSrc}
                alt={`${posterAlt} 缩略图大图预览`}
                className="max-h-full max-w-full object-contain"
                onError={handleThumbError}
              />
            ) : (
              <ImageIcon className="h-8 w-8 text-white/25" />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

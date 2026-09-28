import type { NormalizedCropRegion } from "@mdcz/shared/posterCrop";
import type { FieldDiff, LocalScanEntry, MaintenanceItemResult, MaintenancePreviewItem } from "@mdcz/shared/types";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  ScrollArea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@mdcz/ui";
import {
  Crop,
  FileText,
  FolderOpen,
  GitCompareArrows,
  ImageIcon,
  MousePointerClick,
  Play,
  Star,
  X,
} from "lucide-react";
import { type Dispatch, type SetStateAction, useState } from "react";
import type { PosterCropEditSession } from "../adapters/ports";
import { NaturalAspectImageFrame } from "../common";
import { useT } from "../i18n";
import { ChangeDiffView, type MaintenanceFieldSelectionSide, PathPlanView } from "../maintenance";
import { type EditableNfoData, NfoEditorDialog, type NfoValidationErrors } from "../nfo";
import { formatBitrate, formatDuration } from "./detailViewAdapters";
import { PosterCropDialog } from "./PosterCropDialog";
import { type ResolveImageCandidates, SceneImageGallery } from "./SceneImageGallery";
import type { DetailViewItem } from "./types";

export interface DetailPanelCompareProps {
  result?: MaintenanceItemResult | MaintenancePreviewItem;
  badgeLabel?: string;
  titleOverride?: string;
  entry?: LocalScanEntry;
  preview?: MaintenancePreviewItem;
  fieldSelections?: Record<string, MaintenanceFieldSelectionSide>;
  onFieldSelectionChange?: (fileId: string, field: FieldDiff["field"], side: MaintenanceFieldSelectionSide) => void;
}

export interface DetailPanelNfoState {
  open: boolean;
  data: EditableNfoData;
  dirty: boolean;
  errors: NfoValidationErrors;
  loading: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onDataChange: Dispatch<SetStateAction<EditableNfoData>>;
  onSave: () => void;
}

export interface DetailPanelViewProps {
  item?: DetailViewItem | null;
  emptyMessage?: string;
  compare?: DetailPanelCompareProps;
  posterSrc?: string;
  thumbSrc?: string;
  trailerSrc?: string;
  nfo: DetailPanelNfoState;
  onPlay?: () => void;
  onOpenFolder?: () => void;
  onOpenMetadataFolder?: () => void;
  onOpenNfo?: () => void;
  onPosterError?: () => void;
  onThumbError?: () => void;
  onTrailerError?: () => void;
  resolveImageCandidates: ResolveImageCandidates;
  showFilePath: boolean;
  posterEditor: {
    open: boolean;
    session: PosterCropEditSession | null;
    crop: NormalizedCropRegion | null;
    saving: boolean;
    onCropChange: (crop: NormalizedCropRegion) => void;
    onOpen: () => void;
    onOpenChange: (open: boolean) => void;
    onSave: () => void;
  };
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
  const t = useT();
  return (
    <div className="rounded-quiet bg-red-50/70 p-4 dark:bg-red-950/20">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-destructive/80">
        {t.detail.errorDetails}
      </div>
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
  onPlay?: () => void;
  onOpenFolder?: () => void;
  onOpenMetadataFolder?: () => void;
  onOpenNfo?: () => void;
}

function DetailActionButtons({
  nfoLoading,
  onPlay,
  onOpenFolder,
  onOpenMetadataFolder,
  onOpenNfo,
}: DetailActionButtonsProps) {
  const t = useT();
  return (
    <>
      {onPlay ? (
        <Button
          size="sm"
          variant="ghost"
          className="rounded-quiet-capsule bg-surface-low/75 px-3.5 text-foreground/80 hover:bg-surface-low"
          onClick={onPlay}
        >
          <Play className="h-4 w-4" />
          {t.detail.play}
        </Button>
      ) : null}
      {onOpenFolder ? (
        <Button
          size="sm"
          variant="ghost"
          className="rounded-quiet-capsule bg-surface-low/75 px-3.5 text-foreground/80 hover:bg-surface-low"
          onClick={onOpenFolder}
        >
          <FolderOpen className="h-4 w-4" />
          {t.detail.openSourceFolder}
        </Button>
      ) : null}
      {onOpenMetadataFolder && (
        <Button size="sm" variant="ghost" onClick={onOpenMetadataFolder}>
          <FolderOpen className="h-4 w-4" />
          {t.detail.openMetadataFolder}
        </Button>
      )}
      {onOpenNfo ? (
        <Button
          size="sm"
          variant="ghost"
          className="rounded-quiet-capsule bg-surface-low/75 px-3.5 text-foreground/80 hover:bg-surface-low"
          onClick={onOpenNfo}
          disabled={nfoLoading}
        >
          <FileText className="h-4 w-4" />
          {t.detail.editNfo}
        </Button>
      ) : null}
    </>
  );
}

const getDirFromPath = (path: string): string => {
  const normalized = path.replace(/[\\/]+$/u, "");
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return index >= 0 ? normalized.slice(0, index) : "";
};

export function DetailPanelView({
  item,
  emptyMessage,
  compare,
  posterSrc = "",
  thumbSrc = "",
  trailerSrc = "",
  nfo,
  onPlay,
  onOpenFolder,
  onOpenMetadataFolder,
  onOpenNfo,
  onPosterError,
  onThumbError,
  onTrailerError,
  resolveImageCandidates,
  showFilePath,
  posterEditor,
}: DetailPanelViewProps) {
  const t = useT();
  const [thumbPreviewOpen, setThumbPreviewOpen] = useState(false);

  if (!item) {
    return <EmptyState message={emptyMessage ?? t.detail.selectItemPrompt} />;
  }

  if (compare) {
    const compareError = compare.result?.error ?? (!compare.result ? item.errorMessage : undefined);
    const hasComparedResult = Boolean(compare.result);
    const shouldRenderDiffs = hasComparedResult || !compareError;

    return (
      <div className="flex h-full flex-col overflow-hidden bg-gradient-to-b from-surface-canvas via-surface-canvas to-surface-low/30">
        <div className="shrink-0 px-5 py-4 md:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="mt-2 text-xl font-extrabold tracking-tight text-foreground">{item.number}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{compare.titleOverride ?? item.title ?? item.number}</p>
            </div>
            <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
              <Badge variant="outline" className="gap-1 self-start rounded-full px-2.5 py-1 text-xs sm:self-auto">
                <GitCompareArrows className="h-3.5 w-3.5" />
                {compare.badgeLabel ?? t.detail.dataCompare}
              </Badge>
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="flex min-h-full flex-col space-y-4 px-5 pb-24 md:px-6">
            {showFilePath && compareError && item.path ? (
              <DetailPathBlock label={t.detail.filePath} value={item.path} />
            ) : null}
            {compareError ? <DetailErrorBlock value={compareError} /> : null}

            {shouldRenderDiffs ? (
              <ChangeDiffView
                fileId={item.id}
                diffs={compare.result?.fieldDiffs ?? []}
                unchangedDiffs={compare.result?.unchangedFieldDiffs ?? []}
                hasResult={hasComparedResult}
                entry={compare.entry}
                preview={compare.preview}
                fieldSelections={compare.fieldSelections}
                onFieldSelectionChange={compare.onFieldSelectionChange}
                resolveImageCandidates={resolveImageCandidates}
                imageBaseDir={item.outputPath ?? (item.path ? getDirFromPath(item.path) : undefined)}
              />
            ) : null}

            {compare.result?.pathDiff ? <PathPlanView pathDiff={compare.result.pathDiff} /> : null}
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
    item.actors && item.actors.length > 0
      ? { label: t.detail.fields.actors, value: item.actors.join(", ") }
      : undefined,
    item.studio ? { label: t.detail.fields.studio, value: item.studio } : undefined,
    item.releaseDate ? { label: t.detail.fields.releaseDate, value: item.releaseDate } : undefined,
    item.series ? { label: t.detail.fields.series, value: item.series } : undefined,
  ].filter((field): field is { label: string; value: string } => Boolean(field?.value));
  const metadataRightColumn = [
    item.director ? { label: t.detail.fields.director, value: item.director } : undefined,
    item.genres && item.genres.length > 0
      ? { label: t.detail.fields.genres, value: item.genres.join(", ") }
      : undefined,
  ].filter((field): field is { label: string; value: string } => Boolean(field?.value));
  const technicalFields = [
    item.resolution ? { label: t.detail.fields.resolution, value: item.resolution } : undefined,
    bitrateLabel ? { label: t.detail.fields.bitrate, value: bitrateLabel } : undefined,
  ].filter((field): field is { label: string; value: string } => Boolean(field?.value));
  const supportingFields = [
    durationLabel ? { label: t.detail.fields.duration, value: durationLabel } : undefined,
    item.publisher ? { label: t.detail.fields.publisher, value: item.publisher } : undefined,
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
                  <DetailSectionTitle>{t.detail.sections.details}</DetailSectionTitle>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-3xl font-extrabold tracking-tight text-foreground">{titleLabel}</h2>
                    <div className="flex flex-wrap gap-2">
                      <DetailActionButtons
                        nfoLoading={nfo.loading}
                        onPlay={onPlay}
                        onOpenFolder={onOpenFolder}
                        onOpenMetadataFolder={onOpenMetadataFolder}
                        onOpenNfo={onOpenNfo}
                      />
                    </div>
                  </div>
                </div>
                {showFilePath && item.path ? <DetailPathBlock label={t.detail.filePath} value={item.path} /> : null}
                {item.errorMessage ? <DetailErrorBlock value={item.errorMessage} /> : null}
              </>
            ) : (
              <>
                <section className="grid gap-6 min-[960px]:grid-cols-[minmax(0,180px)_minmax(0,1fr)] min-[960px]:items-start">
                  <div className="w-full max-w-[180px] shrink-0">
                    {posterSrc ? (
                      <div className="group relative aspect-2/3 overflow-hidden rounded-quiet-lg border border-black/5 bg-surface-low/70 shadow-[0_18px_48px_rgba(0,0,0,0.08)]">
                        <img
                          src={posterSrc}
                          alt={posterAlt}
                          className="h-full w-full object-cover"
                          onError={onPosterError}
                        />
                        {posterEditor.session ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  variant="secondary"
                                  aria-label={t.detail.editCover}
                                  className="absolute right-2 bottom-2 bg-surface-floating/90 opacity-90 shadow-sm backdrop-blur-sm hover:opacity-100"
                                  onClick={posterEditor.onOpen}
                                >
                                  <Crop />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="right">{t.detail.editCover}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : null}
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
                        {topMetaNumber ? (
                          <span className="font-numeric text-xl text-muted-foreground/80">{topMetaNumber}</span>
                        ) : null}
                        {ratingLabel ? (
                          <span className="inline-flex items-center gap-1.5 font-numeric text-base font-semibold text-foreground">
                            <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                            {ratingLabel}
                          </span>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <DetailActionButtons
                          nfoLoading={nfo.loading}
                          onPlay={onPlay}
                          onOpenFolder={onOpenFolder}
                          onOpenMetadataFolder={onOpenMetadataFolder}
                          onOpenNfo={onOpenNfo}
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

                          {technicalFields.length > 0 ? (
                            <div className="grid gap-4 sm:grid-cols-2">
                              {technicalFields.map((field) => (
                                <DetailField key={field.label} label={field.label} value={field.value} />
                              ))}
                            </div>
                          ) : null}

                          {supportingFields.length > 0 ? (
                            <div className="grid gap-4 sm:grid-cols-2">
                              {supportingFields.map((field) => (
                                <DetailField key={field.label} label={field.label} value={field.value} />
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {item.plot ? (
                  <section className="space-y-3">
                    <DetailSectionTitle>{t.detail.sections.plot}</DetailSectionTitle>
                    <p className="max-w-4xl whitespace-pre-wrap text-[15px] leading-7 text-foreground/88">
                      {item.plot}
                    </p>
                  </section>
                ) : null}

                {shouldShowThumb ? (
                  <section className="space-y-3">
                    <DetailSectionTitle>{t.detail.sections.poster}</DetailSectionTitle>
                    <button
                      type="button"
                      className="block w-full max-w-4xl cursor-zoom-in transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                      onClick={() => setThumbPreviewOpen(true)}
                    >
                      <NaturalAspectImageFrame
                        src={thumbSrc}
                        alt={t.detail.posterThumbAlt(posterAlt)}
                        className="rounded-quiet-lg border border-black/5 bg-surface-low/70 shadow-[0_18px_48px_rgba(0,0,0,0.08)]"
                        onError={onThumbError}
                      />
                    </button>
                  </section>
                ) : null}

                {item.sceneImages && item.sceneImages.length > 0 ? (
                  <section className="space-y-3">
                    <SceneImageGallery
                      images={item.sceneImages}
                      baseDir={item.outputPath ?? (item.path ? getDirFromPath(item.path) : undefined)}
                      label={t.detail.sections.stills}
                      resolveImageCandidates={resolveImageCandidates}
                      variant="filmstrip"
                    />
                  </section>
                ) : null}

                {trailerSrc ? (
                  <section className="space-y-3">
                    <DetailSectionTitle>{t.detail.sections.trailer}</DetailSectionTitle>
                    {/* biome-ignore lint/a11y/useMediaCaption: Remote trailers do not provide a caption track. */}
                    <video
                      className="w-full max-w-4xl rounded-quiet-lg bg-black"
                      controls
                      preload="metadata"
                      src={trailerSrc}
                      onError={onTrailerError}
                    />
                  </section>
                ) : null}

                {showFilePath && item.path ? <DetailPathBlock label={t.detail.filePath} value={item.path} /> : null}
                {item.errorMessage ? <DetailErrorBlock value={item.errorMessage} /> : null}
              </>
            )}
          </div>
        </ScrollArea>
      </div>

      <NfoEditorDialog
        open={nfo.open}
        data={nfo.data}
        errors={nfo.errors}
        dirty={nfo.dirty}
        saving={nfo.saving}
        onOpenChange={nfo.onOpenChange}
        onDataChange={nfo.onDataChange}
        onSave={nfo.onSave}
      />

      <PosterCropDialog
        open={posterEditor.open}
        session={posterEditor.session}
        crop={posterEditor.crop}
        saving={posterEditor.saving}
        onCropChange={posterEditor.onCropChange}
        onOpenChange={posterEditor.onOpenChange}
        onSave={posterEditor.onSave}
      />

      <Dialog open={thumbPreviewOpen} onOpenChange={setThumbPreviewOpen}>
        <DialogContent
          showCloseButton={false}
          className="flex w-fit max-w-none items-center justify-center gap-0 overflow-visible border-0 bg-transparent p-0 shadow-none backdrop-blur-none sm:max-w-none"
        >
          <DialogTitle className="sr-only">{t.detail.posterPreviewTitle}</DialogTitle>
          <DialogDescription className="sr-only">{t.detail.posterPreviewDescription}</DialogDescription>
          <button
            type="button"
            onClick={() => setThumbPreviewOpen(false)}
            aria-label={t.detail.closePosterPreview}
            className="absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex max-h-[82vh] max-w-[90vw] items-center justify-center">
            {shouldShowThumb ? (
              <img
                src={thumbSrc}
                alt={t.detail.posterPreviewAlt(posterAlt)}
                className="block max-h-[82vh] max-w-[90vw] object-contain"
                onError={onThumbError}
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

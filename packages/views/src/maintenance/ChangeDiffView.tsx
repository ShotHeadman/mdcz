import type { ActorProfile, CrawlerData, FieldDiff, LocalScanEntry, MaintenancePreviewItem } from "@mdcz/shared/types";
import { cn, Dialog, DialogContent, DialogDescription, DialogTitle } from "@mdcz/ui";
import { ChevronLeft, ChevronRight, Clock, ImageIcon, LoaderCircle, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { ImageOptionCard } from "../common";

export type MaintenanceFieldSelectionSide = "old" | "new";

export interface MaintenanceImageOptionProps {
  defaultAspectRatio?: number;
  src: string;
  fallbackSrcs?: string[];
  label: string;
  selected?: boolean;
  empty?: boolean;
  emptyText?: string;
  sourceRows?: Array<{
    label: string;
    value: string;
  }>;
  onClick?: () => void;
  baseDir?: string;
  imageFrameClassName?: string;
  metadataClassName?: string;
  resolveImageCandidates?: ResolveMaintenanceImageCandidates;
}

export interface MaintenanceSceneImageOptionProps {
  images: string[];
  maxThumbnails?: number;
  label?: string;
  baseDir?: string;
  resolveImageCandidates?: ResolveMaintenanceImageCandidates;
}

export type ResolveMaintenanceImageCandidates = (candidates: string[], baseDir?: string) => Promise<string[]>;

export interface ChangeDiffViewProps {
  fileId: string;
  diffs: FieldDiff[];
  unchangedDiffs?: FieldDiff[];
  hasResult?: boolean;
  entry?: LocalScanEntry;
  preview?: MaintenancePreviewItem;
  fieldSelections?: Record<string, MaintenanceFieldSelectionSide>;
  onFieldSelectionChange?: (fileId: string, field: FieldDiff["field"], side: MaintenanceFieldSelectionSide) => void;
  renderImageOption?: (props: MaintenanceImageOptionProps) => ReactNode;
  renderSceneImages?: (props: MaintenanceSceneImageOptionProps) => ReactNode;
  resolveImageCandidates?: ResolveMaintenanceImageCandidates;
  imageBaseDir?: string;
}

const toJoinedProfileNames = (profiles: ActorProfile[]) => profiles.map((profile) => profile.name).join(", ");
const IMAGE_SOURCE_FIELD_MAP = {
  thumb_url: "thumb_source_url",
  poster_url: "poster_source_url",
} as const;

const getImageSourceField = (
  field: FieldDiff["field"],
): (typeof IMAGE_SOURCE_FIELD_MAP)[keyof typeof IMAGE_SOURCE_FIELD_MAP] | undefined => {
  switch (field) {
    case "thumb_url":
    case "poster_url":
      return IMAGE_SOURCE_FIELD_MAP[field];
    default:
      return undefined;
  }
};

export const hasMaintenanceFieldValue = (value: unknown): boolean => {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

export const hasMaintenanceDiffSideValue = (diff: FieldDiff, side: MaintenanceFieldSelectionSide): boolean => {
  if (diff.kind === "image") {
    const preview = side === "old" ? diff.oldPreview : diff.newPreview;
    return preview.src.length > 0 || preview.fallbackSrcs.length > 0;
  }

  if (diff.kind === "imageCollection") {
    const preview = side === "old" ? diff.oldPreview : diff.newPreview;
    return preview.items.length > 0;
  }

  return hasMaintenanceFieldValue(side === "old" ? diff.oldValue : diff.newValue);
};

export const resolveMaintenanceDiffImageOption = (
  diff: FieldDiff,
  side: MaintenanceFieldSelectionSide,
): { src: string; fallbackSrcs: string[] } => {
  if (diff.kind !== "image") {
    return { src: "", fallbackSrcs: [] };
  }

  return side === "old" ? diff.oldPreview : diff.newPreview;
};

export const resolveMaintenanceDiffImageCollection = (
  diff: FieldDiff,
  side: MaintenanceFieldSelectionSide,
): string[] => {
  if (diff.kind !== "imageCollection") {
    return [];
  }

  return side === "old" ? diff.oldPreview.items : diff.newPreview.items;
};

export const getDefaultMaintenanceFieldSelection = (diff: FieldDiff): MaintenanceFieldSelectionSide => {
  const hasOldValue = hasMaintenanceDiffSideValue(diff, "old");
  const hasNewValue = hasMaintenanceDiffSideValue(diff, "new");

  if (!hasOldValue && hasNewValue) return "new";
  if (hasOldValue && !hasNewValue) return "old";
  return "new";
};

const formatValue = (value: unknown): string => {
  if (!hasMaintenanceFieldValue(value)) {
    return "(空)";
  }
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "string")) {
      return (value as string[]).join(", ");
    }
    if (
      value.every(
        (item) => item && typeof item === "object" && "name" in item && typeof (item as ActorProfile).name === "string",
      )
    ) {
      return toJoinedProfileNames(value as ActorProfile[]);
    }
    return JSON.stringify(value, null, 2);
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
};

const toDisplaySourceValue = (value: unknown): string => {
  if (typeof value !== "string") {
    return "(空)";
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : "(空)";
};

const resolveImageSourceValue = (
  crawlerData: CrawlerData | undefined,
  diff: Extract<FieldDiff, { kind: "image" }>,
  side: "old" | "new",
  previewSrc: string,
): string => {
  const sourceField = getImageSourceField(diff.field);
  if (!sourceField) {
    return toDisplaySourceValue(side === "old" ? diff.oldValue : diff.newValue || previewSrc);
  }

  const explicitSource = crawlerData?.[sourceField];

  if (typeof explicitSource === "string" && explicitSource.trim().length > 0) {
    return explicitSource.trim();
  }

  return toDisplaySourceValue(side === "old" ? diff.oldValue : diff.newValue || previewSrc);
};

const dedupeValues = (values: string[]): string[] =>
  values
    .map((value) => value.trim())
    .filter((value, index, items) => value.length > 0 && items.indexOf(value) === index);

const defaultResolveImageCandidates: ResolveMaintenanceImageCandidates = async (candidates) => dedupeValues(candidates);

const getImageDisplayProps = (
  field: FieldDiff["field"],
): Pick<MaintenanceImageOptionProps, "defaultAspectRatio" | "imageFrameClassName" | "metadataClassName"> => {
  if (field === "poster_url") {
    return {
      defaultAspectRatio: 2 / 3,
      imageFrameClassName: "max-w-48",
      metadataClassName: "max-w-48",
    };
  }

  return {
    defaultAspectRatio: 16 / 9,
    imageFrameClassName: "max-w-xl",
    metadataClassName: "max-w-xl",
  };
};

const getDirFromPath = (path: string | undefined): string | undefined => {
  const trimmed = path?.trim();
  if (!trimmed) {
    return undefined;
  }
  const normalized = trimmed.replace(/[\\/]+$/u, "");
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return index >= 0 ? normalized.slice(0, index) : undefined;
};

const getMaintenanceImageBaseDir = (entry: LocalScanEntry | undefined): string | undefined =>
  entry?.currentDir || getDirFromPath(entry?.nfoPath) || getDirFromPath(entry?.fileInfo.filePath);

const useResolvedMaintenanceImageCandidates = (
  resolveImageCandidates: ResolveMaintenanceImageCandidates,
  rawCandidates: string[],
  baseDir?: string,
): string[] => {
  const candidateKey = rawCandidates.map((candidate) => candidate.trim()).join("\u0000");
  const [resolved, setResolved] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const candidates = candidateKey ? candidateKey.split("\u0000").filter(Boolean) : [];

    const resolve = async () => {
      const next = await resolveImageCandidates(candidates, baseDir);
      if (!cancelled) {
        setResolved(next);
      }
    };

    void resolve();

    return () => {
      cancelled = true;
    };
  }, [baseDir, candidateKey, resolveImageCandidates]);

  return resolved;
};

function DiffOption({
  title,
  value,
  selected,
  disabled,
  onClick,
}: {
  title: string;
  value: unknown;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "min-h-32 rounded-quiet bg-surface-floating p-4 text-left transition-all",
        selected ? "ring-2 ring-primary/20" : "hover:bg-surface-raised/60",
        disabled && "cursor-not-allowed opacity-50 hover:border-transparent",
      )}
    >
      <div className="mb-2 text-xs font-medium text-muted-foreground">{title}</div>
      <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
        {formatValue(value)}
      </div>
    </button>
  );
}

function DefaultSceneImageGallery({
  images,
  maxThumbnails = 8,
  label,
  baseDir,
  resolveImageCandidates = defaultResolveImageCandidates,
}: MaintenanceSceneImageOptionProps) {
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const isOpen = lightboxIndex >= 0;
  const visibleThumbnails = images.slice(0, maxThumbnails);
  const remainingCount = images.length - maxThumbnails;
  const closeLightbox = useCallback(() => setLightboxIndex(-1), []);
  const goPrev = useCallback(() => {
    setLightboxIndex((index) => (index > 0 ? index - 1 : images.length - 1));
  }, [images.length]);
  const goNext = useCallback(() => {
    setLightboxIndex((index) => (index < images.length - 1 ? index + 1 : 0));
  }, [images.length]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeLightbox();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeLightbox, goNext, goPrev, isOpen]);

  if (images.length === 0) return null;

  return (
    <div>
      {label ? (
        <div className="mb-2 text-xs text-muted-foreground">
          {label} ({images.length})
        </div>
      ) : null}
      <div className="flex gap-1.5 overflow-x-auto p-1 scrollbar-thin">
        {visibleThumbnails.map((imagePath, index) => (
          <button
            key={imagePath}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setLightboxIndex(index);
            }}
            className="h-14 w-20 shrink-0 cursor-pointer rounded-md border bg-muted/20 transition-all hover:ring-2 hover:ring-primary/50"
          >
            <ResolvedSceneThumbnail
              src={imagePath}
              alt={`Scene ${index + 1}`}
              baseDir={baseDir}
              resolveImageCandidates={resolveImageCandidates}
            />
          </button>
        ))}
        {remainingCount > 0 && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setLightboxIndex(maxThumbnails);
            }}
            className="flex h-14 w-20 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border bg-muted/30 transition-colors hover:bg-muted/50"
          >
            <span className="text-xs font-medium text-muted-foreground">+{remainingCount}</span>
          </button>
        )}
      </div>

      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) closeLightbox();
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="flex w-fit max-w-none items-center justify-center gap-0 overflow-visible border-0 bg-transparent p-0 shadow-none backdrop-blur-none sm:max-w-none"
        >
          <DialogTitle className="sr-only">剧照预览</DialogTitle>
          <DialogDescription className="sr-only">
            查看剧照大图预览，当前第 {lightboxIndex + 1} 张，共 {images.length} 张，可使用左右方向键切换。
          </DialogDescription>
          <button
            type="button"
            onClick={closeLightbox}
            aria-label="关闭剧照预览"
            className="absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="absolute top-3 left-3 z-10 rounded bg-black/60 px-2 py-0.5 font-mono text-sm text-white/80">
            {lightboxIndex + 1} / {images.length}
          </div>
          {images.length > 1 && (
            <>
              <button
                type="button"
                onClick={goPrev}
                aria-label="上一张剧照"
                className="absolute left-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={goNext}
                aria-label="下一张剧照"
                className="absolute right-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          )}
          <div className="flex max-h-[82vh] max-w-[90vw] items-center justify-center">
            {lightboxIndex >= 0 && lightboxIndex < images.length && (
              <ResolvedSceneLightboxImage
                src={images[lightboxIndex]}
                alt={`Scene ${lightboxIndex + 1}`}
                baseDir={baseDir}
                resolveImageCandidates={resolveImageCandidates}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ResolvedSceneThumbnail({
  src,
  alt,
  baseDir,
  resolveImageCandidates,
}: {
  src: string;
  alt: string;
  baseDir?: string;
  resolveImageCandidates: ResolveMaintenanceImageCandidates;
}) {
  const [resolvedSrc = ""] = useResolvedMaintenanceImageCandidates(resolveImageCandidates, [src], baseDir);

  if (!resolvedSrc) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <ImageIcon className="h-4 w-4 text-muted-foreground/30" />
      </div>
    );
  }

  return <img src={resolvedSrc} alt={alt} className="h-full w-full rounded-md object-cover" />;
}

function ResolvedSceneLightboxImage({
  src,
  alt,
  baseDir,
  resolveImageCandidates,
}: {
  src: string;
  alt: string;
  baseDir?: string;
  resolveImageCandidates: ResolveMaintenanceImageCandidates;
}) {
  const [resolvedSrc = ""] = useResolvedMaintenanceImageCandidates(resolveImageCandidates, [src], baseDir);

  if (!resolvedSrc) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <ImageIcon className="h-8 w-8 text-white/25" />
      </div>
    );
  }

  return <img src={resolvedSrc} alt={alt} className="block max-h-[82vh] max-w-[90vw] object-contain" />;
}

function SceneImageOption({
  title,
  images,
  selected,
  disabled,
  emptyText,
  onClick,
  renderSceneImages,
  baseDir,
}: {
  title: string;
  images: string[];
  selected: boolean;
  disabled: boolean;
  emptyText: string;
  onClick?: () => void;
  renderSceneImages: (props: MaintenanceSceneImageOptionProps) => ReactNode;
  baseDir?: string;
}) {
  const clickable = Boolean(onClick) && !disabled;
  const titleNode = (
    <div className="text-xs font-medium text-muted-foreground">
      {title} {images.length > 0 ? `(${images.length})` : ""}
    </div>
  );

  return (
    <div
      className={cn(
        "min-h-32 rounded-quiet bg-surface-floating p-4 text-left transition-all",
        selected ? "ring-2 ring-primary/20" : "hover:bg-surface-raised/60",
        disabled && "cursor-not-allowed opacity-50 hover:border-transparent",
      )}
    >
      {clickable ? (
        <button type="button" onClick={onClick} className="mb-2 w-full text-left outline-none">
          {titleNode}
        </button>
      ) : (
        <div className="mb-2">{titleNode}</div>
      )}
      {images.length > 0 ? (
        renderSceneImages({ images, maxThumbnails: 8, baseDir })
      ) : (
        <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed bg-muted/20 text-sm text-muted-foreground">
          {emptyText}
        </div>
      )}
    </div>
  );
}

function TrailerOptionCard({
  title,
  candidates,
  selected,
  disabled,
  emptyText,
  onClick,
  baseDir,
  resolveImageCandidates = defaultResolveImageCandidates,
}: {
  title: string;
  candidates: string[];
  selected: boolean;
  disabled: boolean;
  emptyText: string;
  onClick?: () => void;
  baseDir?: string;
  resolveImageCandidates?: ResolveMaintenanceImageCandidates;
}) {
  const [candidateIndex, setCandidateIndex] = useState(0);
  const resolvedCandidates = useResolvedMaintenanceImageCandidates(resolveImageCandidates, candidates, baseDir);

  useEffect(() => {
    setCandidateIndex(0);
  }, [resolvedCandidates]);

  const handleVideoError = useCallback(() => {
    setCandidateIndex((prev) => Math.min(prev + 1, resolvedCandidates.length));
  }, [resolvedCandidates.length]);

  const currentSrc = resolvedCandidates[candidateIndex] || "";
  const displayLabel = candidates[candidateIndex] || candidates[0] || "";
  const clickable = Boolean(onClick) && !disabled;
  const titleNode = <div className="text-xs font-medium text-muted-foreground">{title}</div>;

  return (
    <div
      className={cn(
        "min-h-32 rounded-quiet bg-surface-floating p-4 text-left transition-all",
        selected ? "ring-2 ring-primary/20" : "hover:bg-surface-raised/60",
        disabled && "cursor-not-allowed opacity-50 hover:border-transparent",
      )}
    >
      {clickable ? (
        <button type="button" onClick={onClick} className="mb-2 w-full text-left outline-none">
          {titleNode}
        </button>
      ) : (
        <div className="mb-2">{titleNode}</div>
      )}
      {currentSrc ? (
        <div className="space-y-2">
          {/* biome-ignore lint/a11y/useMediaCaption: Trailers do not provide caption tracks. */}
          <video
            className="w-full max-h-60 rounded-md bg-black object-contain"
            controls
            preload="metadata"
            src={currentSrc}
            onError={handleVideoError}
          />
          <div className="truncate text-xs text-muted-foreground" title={displayLabel}>
            {displayLabel}
          </div>
        </div>
      ) : (
        <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed bg-muted/20 text-sm text-muted-foreground">
          {emptyText}
        </div>
      )}
    </div>
  );
}

const sortDiffsForDisplay = (diffList: FieldDiff[]): FieldDiff[] => {
  const nonTrailerDiffs: FieldDiff[] = [];
  const trailerDiffs: FieldDiff[] = [];
  for (const diff of diffList) {
    if (diff.field === "trailer_url") {
      trailerDiffs.push(diff);
    } else {
      nonTrailerDiffs.push(diff);
    }
  }
  return [...nonTrailerDiffs, ...trailerDiffs];
};

export function ChangeDiffView({
  fileId,
  diffs,
  unchangedDiffs = [],
  hasResult = false,
  entry,
  preview,
  fieldSelections,
  onFieldSelectionChange,
  renderImageOption = (props) => <ImageOptionCard {...props} />,
  renderSceneImages = (props) => <DefaultSceneImageGallery {...props} />,
  resolveImageCandidates = defaultResolveImageCandidates,
  imageBaseDir,
}: ChangeDiffViewProps) {
  const baseDir = imageBaseDir || getMaintenanceImageBaseDir(entry);
  const renderResolvedImageOption = (props: MaintenanceImageOptionProps) =>
    renderImageOption({
      ...props,
      baseDir,
      resolveImageCandidates,
    });
  const renderResolvedSceneImages = (props: MaintenanceSceneImageOptionProps) =>
    renderSceneImages({
      ...props,
      baseDir,
      resolveImageCandidates,
    });
  const selectField = (field: FieldDiff["field"], side: MaintenanceFieldSelectionSide) => {
    onFieldSelectionChange?.(fileId, field, side);
  };

  const renderChangedOptions = (diff: FieldDiff) => {
    const selectedSide = fieldSelections?.[diff.field] ?? getDefaultMaintenanceFieldSelection(diff);
    const hasOldValue = hasMaintenanceDiffSideValue(diff, "old");
    const hasNewValue = hasMaintenanceDiffSideValue(diff, "new");

    if (diff.kind === "image") {
      const oldImage = resolveMaintenanceDiffImageOption(diff, "old");
      const newImage = resolveMaintenanceDiffImageOption(diff, "new");
      const imageDisplayProps = getImageDisplayProps(diff.field);

      return (
        <div className="grid gap-3 md:grid-cols-2">
          {renderResolvedImageOption({
            ...imageDisplayProps,
            src: oldImage.src,
            fallbackSrcs: oldImage.fallbackSrcs,
            label: "旧 (当前)",
            selected: selectedSide === "old",
            empty: !hasOldValue,
            emptyText: "旧值为空",
            sourceRows: [
              { label: "图片来源", value: resolveImageSourceValue(entry?.crawlerData, diff, "old", oldImage.src) },
            ],
            onClick: hasOldValue && hasNewValue ? () => selectField(diff.field, "old") : undefined,
          })}
          {renderResolvedImageOption({
            ...imageDisplayProps,
            src: newImage.src,
            fallbackSrcs: newImage.fallbackSrcs,
            label: "新 (预览)",
            selected: selectedSide === "new",
            empty: !hasNewValue,
            emptyText: "新值为空",
            sourceRows: [
              {
                label: "图片来源",
                value: resolveImageSourceValue(preview?.proposedCrawlerData, diff, "new", newImage.src),
              },
            ],
            onClick: hasOldValue && hasNewValue ? () => selectField(diff.field, "new") : undefined,
          })}
        </div>
      );
    }

    if (diff.kind === "imageCollection") {
      const oldImages = resolveMaintenanceDiffImageCollection(diff, "old");
      const newImages = resolveMaintenanceDiffImageCollection(diff, "new");

      return (
        <div className="grid gap-3 md:grid-cols-2">
          <SceneImageOption
            title="旧 (当前)"
            images={oldImages}
            selected={selectedSide === "old"}
            disabled={!hasOldValue}
            emptyText="当前没有本地剧照"
            onClick={hasOldValue && hasNewValue ? () => selectField(diff.field, "old") : undefined}
            renderSceneImages={renderResolvedSceneImages}
            baseDir={baseDir}
          />
          <SceneImageOption
            title="新 (预览)"
            images={newImages}
            selected={selectedSide === "new"}
            disabled={!hasNewValue}
            emptyText="新值为空"
            onClick={hasOldValue && hasNewValue ? () => selectField(diff.field, "new") : undefined}
            renderSceneImages={renderResolvedSceneImages}
            baseDir={baseDir}
          />
        </div>
      );
    }

    if (diff.field === "trailer_url") {
      const oldTrailerCandidates = dedupeValues(
        [
          entry?.assets.trailer,
          diff.oldValue as string,
          entry?.crawlerData?.trailer_source_url,
          entry?.crawlerData?.trailer_url,
        ].filter((item): item is string => typeof item === "string" && item.trim().length > 0),
      );
      const newTrailerCandidates = dedupeValues(
        [
          diff.newValue as string,
          preview?.proposedCrawlerData?.trailer_source_url,
          preview?.proposedCrawlerData?.trailer_url,
        ].filter((item): item is string => typeof item === "string" && item.trim().length > 0),
      );

      return (
        <div className="grid gap-3 md:grid-cols-2">
          <TrailerOptionCard
            title="旧 (当前)"
            candidates={oldTrailerCandidates}
            selected={selectedSide === "old"}
            disabled={!hasOldValue && oldTrailerCandidates.length === 0}
            emptyText="当前没有预告片"
            onClick={hasOldValue && hasNewValue ? () => selectField(diff.field, "old") : undefined}
            baseDir={baseDir}
            resolveImageCandidates={resolveImageCandidates}
          />
          <TrailerOptionCard
            title="新 (预览)"
            candidates={newTrailerCandidates}
            selected={selectedSide === "new"}
            disabled={!hasNewValue && newTrailerCandidates.length === 0}
            emptyText="新预告片为空"
            onClick={hasOldValue && hasNewValue ? () => selectField(diff.field, "new") : undefined}
            baseDir={baseDir}
            resolveImageCandidates={resolveImageCandidates}
          />
        </div>
      );
    }

    return (
      <div className="grid gap-3 md:grid-cols-2">
        <DiffOption
          title="旧 (当前)"
          value={diff.oldValue}
          selected={selectedSide === "old"}
          disabled={!hasOldValue}
          onClick={() => selectField(diff.field, "old")}
        />
        <DiffOption
          title="新 (预览)"
          value={diff.newValue}
          selected={selectedSide === "new"}
          disabled={!hasNewValue}
          onClick={() => selectField(diff.field, "new")}
        />
      </div>
    );
  };

  const renderUnchangedValue = (diff: FieldDiff) => {
    if (diff.kind === "image") {
      const current = resolveMaintenanceDiffImageOption(diff, "old");
      return renderResolvedImageOption({
        ...getImageDisplayProps(diff.field),
        src: current.src,
        fallbackSrcs: current.fallbackSrcs,
        label: "当前值",
        sourceRows: [
          { label: "图片来源", value: resolveImageSourceValue(entry?.crawlerData, diff, "old", current.src) },
        ],
        empty: !hasMaintenanceDiffSideValue(diff, "old") && !hasMaintenanceDiffSideValue(diff, "new"),
        emptyText: "当前值为空",
      });
    }

    if (diff.kind === "imageCollection") {
      const currentImages = resolveMaintenanceDiffImageCollection(diff, "old");
      if (currentImages.length === 0) {
        return (
          <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed bg-muted/20 text-sm text-muted-foreground">
            当前没有剧照
          </div>
        );
      }
      return (
        <div className="rounded-quiet bg-surface-floating p-3">
          {renderResolvedSceneImages({
            images: currentImages,
            maxThumbnails: 8,
            baseDir,
          })}
        </div>
      );
    }

    if (diff.field === "trailer_url") {
      const candidates = dedupeValues(
        [
          entry?.assets.trailer,
          diff.oldValue as string,
          diff.newValue as string,
          preview?.proposedCrawlerData?.trailer_source_url ?? entry?.crawlerData?.trailer_source_url,
          preview?.proposedCrawlerData?.trailer_url ?? entry?.crawlerData?.trailer_url,
        ].filter((item): item is string => typeof item === "string" && item.trim().length > 0),
      );
      if (candidates.length === 0) {
        return (
          <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed bg-muted/20 text-sm text-muted-foreground">
            当前没有预告片
          </div>
        );
      }
      return (
        <div className="rounded-quiet bg-surface-floating p-3">
          <TrailerOptionCard
            title="当前预告片"
            candidates={candidates}
            selected={false}
            disabled={false}
            emptyText="当前没有预告片"
            baseDir={baseDir}
            resolveImageCandidates={resolveImageCandidates}
          />
        </div>
      );
    }

    return (
      <div className="whitespace-pre-wrap rounded-xl text-sm leading-relaxed text-foreground wrap-break-word">
        {formatValue(diff.oldValue)}
      </div>
    );
  };

  const renderDiffCard = (diff: FieldDiff, mode: "changed" | "unchanged") => {
    const isUnchangedSceneImages = mode === "unchanged" && diff.kind === "imageCollection";
    const title = isUnchangedSceneImages
      ? `${diff.label} (${resolveMaintenanceDiffImageCollection(diff, "old").length})`
      : diff.label;

    return (
      <section key={`${fileId}-${mode}-${diff.field}`} className="rounded-quiet-lg bg-surface-low/75 p-4 md:p-5">
        <div className="mb-4 text-sm font-semibold tracking-tight text-foreground">{title}</div>
        {mode === "changed" ? renderChangedOptions(diff) : renderUnchangedValue(diff)}
      </section>
    );
  };

  if (diffs.length === 0 && unchangedDiffs.length === 0) {
    const isProcessing = preview?.status === "processing";
    const isPending = preview?.status === "pending";
    return (
      <div className="flex min-h-96 w-full flex-col items-center justify-center gap-3 text-muted-foreground/60">
        {isProcessing ? (
          <>
            <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium">正在获取数据并生成对比...</p>
          </>
        ) : isPending ? (
          <>
            <Clock className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-medium">排队等待中...</p>
          </>
        ) : (
          <p className="text-sm font-medium">{hasResult ? "当前预览未生成字段差异" : "预览后将在此显示字段差异"}</p>
        )}
      </div>
    );
  }

  const sortedDiffs = sortDiffsForDisplay(diffs);
  const sortedUnchangedDiffs = sortDiffsForDisplay(unchangedDiffs);

  return (
    <div className="space-y-6">
      {sortedDiffs.length > 0 && (
        <div className="space-y-4">{sortedDiffs.map((diff) => renderDiffCard(diff, "changed"))}</div>
      )}

      {sortedUnchangedDiffs.length > 0 && (
        <section className="space-y-4">
          <div className="px-1 text-xs font-medium text-muted-foreground">未变更字段</div>
          {sortedUnchangedDiffs.map((diff) => renderDiffCard(diff, "unchanged"))}
        </section>
      )}
    </div>
  );
}

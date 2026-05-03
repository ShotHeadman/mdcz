import type { ActorProfile, CrawlerData, FieldDiff, LocalScanEntry, MaintenancePreviewItem } from "@mdcz/shared/types";
import { Badge, cn, Dialog, DialogContent, DialogDescription, DialogTitle } from "@mdcz/ui";
import { ChevronLeft, ChevronRight, ImageIcon, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

export type MaintenanceFieldSelectionSide = "old" | "new";

export interface MaintenanceImageOptionProps {
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
}

export interface MaintenanceSceneImageOptionProps {
  images: string[];
  maxThumbnails?: number;
  label?: string;
}

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

function DefaultImageOptionCard({
  src,
  fallbackSrcs = [],
  label,
  selected = false,
  onClick,
  empty = false,
  emptyText = "暂无图片",
  sourceRows = [],
}: MaintenanceImageOptionProps) {
  const [candidateIndex, setCandidateIndex] = useState(0);
  const candidates = useMemo(() => {
    const raw = empty || !src.trim() ? fallbackSrcs : [src, ...fallbackSrcs];
    return raw.filter((candidate, index, items) => candidate.trim().length > 0 && items.indexOf(candidate) === index);
  }, [empty, fallbackSrcs, src]);
  const renderSrc = candidates[candidateIndex] ?? "";
  const clickable = Boolean(onClick) && !empty;
  const content = (
    <div className="flex min-w-0 flex-col items-center gap-4">
      <div className="relative mx-auto flex h-40 w-full max-w-xl shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/20 sm:h-72">
        {empty || !renderSrc ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <ImageIcon className="h-8 w-8 opacity-40" />
            <span className="text-xs">{emptyText}</span>
          </div>
        ) : (
          <img
            src={renderSrc}
            alt={label}
            className="block h-full w-full max-w-full object-contain object-center"
            onError={() => {
              setCandidateIndex((currentIndex) =>
                currentIndex < candidates.length - 1 ? currentIndex + 1 : candidates.length,
              );
            }}
          />
        )}
      </div>
      <div className="mx-auto flex w-full max-w-xl min-w-0 flex-col justify-center gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={selected ? "default" : "secondary"}>{label}</Badge>
        </div>
        {sourceRows.map((row) => (
          <div key={row.label} className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
            <span className="shrink-0">{row.label}:</span>
            <span className="min-w-0 truncate text-foreground/85" title={row.value}>
              {row.value}
            </span>
          </div>
        ))}
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

function DefaultSceneImageGallery({ images, maxThumbnails = 8, label = "预览" }: MaintenanceSceneImageOptionProps) {
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
      <div className="mb-2 text-xs text-muted-foreground">
        {label} ({images.length})
      </div>
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
            <img src={imagePath} alt={`Scene ${index + 1}`} className="h-full w-full rounded-md object-cover" />
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
              <img
                src={images[lightboxIndex]}
                alt={`Scene ${lightboxIndex + 1}`}
                className="block max-h-[82vh] max-w-[90vw] object-contain"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SceneImageOption({
  title,
  images,
  selected,
  disabled,
  emptyText,
  onClick,
  renderSceneImages,
}: {
  title: string;
  images: string[];
  selected: boolean;
  disabled: boolean;
  emptyText: string;
  onClick?: () => void;
  renderSceneImages: (props: MaintenanceSceneImageOptionProps) => ReactNode;
}) {
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
      {images.length > 0 ? (
        renderSceneImages({ images, maxThumbnails: 8 })
      ) : (
        <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed bg-muted/20 text-sm text-muted-foreground">
          {emptyText}
        </div>
      )}
    </div>
  );
}

export function ChangeDiffView({
  fileId,
  diffs,
  unchangedDiffs = [],
  hasResult = false,
  entry,
  preview,
  fieldSelections,
  onFieldSelectionChange,
  renderImageOption = (props) => <DefaultImageOptionCard {...props} />,
  renderSceneImages = (props) => <DefaultSceneImageGallery {...props} />,
}: ChangeDiffViewProps) {
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

      return (
        <div className="grid gap-3 md:grid-cols-2">
          {renderImageOption({
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
          {renderImageOption({
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
            renderSceneImages={renderSceneImages}
          />
          <SceneImageOption
            title="新 (预览)"
            images={newImages}
            selected={selectedSide === "new"}
            disabled={!hasNewValue}
            emptyText="新值为空"
            onClick={hasOldValue && hasNewValue ? () => selectField(diff.field, "new") : undefined}
            renderSceneImages={renderSceneImages}
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
      return renderImageOption({
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
      return (
        <SceneImageOption
          title="当前剧照"
          images={currentImages}
          selected={false}
          disabled
          emptyText="当前没有剧照"
          renderSceneImages={renderSceneImages}
        />
      );
    }

    return (
      <div className="whitespace-pre-wrap rounded-xl text-sm leading-relaxed text-foreground wrap-break-word">
        {formatValue(diff.oldValue)}
      </div>
    );
  };

  const renderDiffCard = (diff: FieldDiff, mode: "changed" | "unchanged") => {
    return (
      <section key={`${fileId}-${mode}-${diff.field}`} className="rounded-quiet-lg bg-surface-low/75 p-4 md:p-5">
        <div className="mb-4 text-sm font-semibold tracking-tight text-foreground">{diff.label}</div>
        {mode === "changed" ? renderChangedOptions(diff) : renderUnchangedValue(diff)}
      </section>
    );
  };

  if (diffs.length === 0 && unchangedDiffs.length === 0) {
    return (
      <div className="flex min-h-96 w-full items-center justify-center text-muted-foreground/60">
        <p className="text-sm font-medium">{hasResult ? "当前预览未生成字段差异" : "预览后将在此显示字段差异"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {diffs.length > 0 && <div className="space-y-4">{diffs.map((diff) => renderDiffCard(diff, "changed"))}</div>}

      {unchangedDiffs.length > 0 && (
        <section className="space-y-4">
          <div className="px-1 text-xs font-medium text-muted-foreground">未变更字段</div>
          {unchangedDiffs.map((diff) => renderDiffCard(diff, "unchanged"))}
        </section>
      )}
    </div>
  );
}

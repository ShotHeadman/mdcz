import { dedupeMediaSources } from "@mdcz/shared/imageSource";
import {
  getDefaultMaintenanceFieldSelection,
  hasMaintenanceDiffSideValue,
  hasMaintenanceFieldValue,
  type MaintenanceFieldSelectionSide,
} from "@mdcz/shared/maintenanceTasks";
import type { ActorProfile, CrawlerData, FieldDiff, LocalScanEntry, MaintenancePreviewItem } from "@mdcz/shared/types";
import { cn } from "@mdcz/ui";
import { Clock, LoaderCircle } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { ImageOptionCard } from "../common";
import { type ResolveImageCandidates, SceneImageGallery } from "../detail/SceneImageGallery";
import { TrailerPlayer } from "../detail/TrailerPlayer";
import { getT, useT } from "../i18n";

export interface ChangeDiffViewProps {
  fileId: string;
  diffs: FieldDiff[];
  unchangedDiffs?: FieldDiff[];
  hasResult?: boolean;
  entry?: LocalScanEntry;
  preview?: MaintenancePreviewItem;
  fieldSelections?: Record<string, MaintenanceFieldSelectionSide>;
  onFieldSelectionChange?: (fileId: string, field: FieldDiff["field"], side: MaintenanceFieldSelectionSide) => void;
  resolveImageCandidates: ResolveImageCandidates;
  imageBaseDir?: string;
}

const SIDES = ["old", "new"] as const;
const IMAGE_SOURCE_FIELDS: Partial<Record<FieldDiff["field"], "thumb_source_url" | "poster_source_url">> = {
  thumb_url: "thumb_source_url",
  poster_url: "poster_source_url",
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

const formatValue = (value: unknown): string => {
  if (!hasMaintenanceFieldValue(value)) {
    return getT().maintenance.empty;
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
      return (value as ActorProfile[]).map((profile) => profile.name).join(", ");
    }
    return JSON.stringify(value, null, 2);
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
};

const resolveImageSourceValue = (
  crawlerData: CrawlerData | undefined,
  diff: Extract<FieldDiff, { kind: "image" }>,
  side: MaintenanceFieldSelectionSide,
  previewSrc: string,
): string => {
  const sourceField = IMAGE_SOURCE_FIELDS[diff.field];
  const explicitSource = sourceField ? crawlerData?.[sourceField] : undefined;
  if (typeof explicitSource === "string" && explicitSource.trim()) {
    return explicitSource.trim();
  }

  const value = side === "old" ? diff.oldValue : diff.newValue || previewSrc;
  return typeof value === "string" && value.trim() ? value.trim() : getT().maintenance.empty;
};

const getImageDisplayProps = (field: FieldDiff["field"]) =>
  field === "poster_url"
    ? { defaultAspectRatio: 2 / 3, imageFrameClassName: "max-w-48", metadataClassName: "max-w-48" }
    : { defaultAspectRatio: 16 / 9, imageFrameClassName: "max-w-xl", metadataClassName: "max-w-xl" };

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

const toTrailerCandidates = (values: unknown[]): string[] =>
  dedupeMediaSources(values.filter((value): value is string => typeof value === "string"));

const trailersLast = (diffs: FieldDiff[]): FieldDiff[] => [
  ...diffs.filter((diff) => diff.field !== "trailer_url"),
  ...diffs.filter((diff) => diff.field === "trailer_url"),
];

const optionCardClassName = (selected: boolean, disabled: boolean) =>
  cn(
    "min-h-32 rounded-quiet bg-surface-floating p-4 text-left transition-all",
    selected ? "ring-2 ring-primary/20" : "hover:bg-surface-raised/60",
    disabled && "cursor-not-allowed opacity-50 hover:border-transparent",
  );

function EmptyValue({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex min-h-28 items-center justify-center rounded-lg border border-dashed bg-muted/20 text-sm text-muted-foreground",
        className,
      )}
    >
      {text}
    </div>
  );
}

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
    <button type="button" onClick={onClick} disabled={disabled} className={optionCardClassName(selected, disabled)}>
      <div className="mb-2 text-xs font-medium text-muted-foreground">{title}</div>
      <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
        {formatValue(value)}
      </div>
    </button>
  );
}

/** The body has controls of its own (stills, a player), so only the title selects the card. */
function OptionCard({
  title,
  selected,
  disabled,
  onClick,
  children,
}: {
  title: string;
  selected: boolean;
  disabled: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const titleClassName = "mb-2 block w-full text-left text-xs font-medium text-muted-foreground";
  return (
    <div className={optionCardClassName(selected, disabled)}>
      {onClick && !disabled ? (
        <button type="button" onClick={onClick} className={cn(titleClassName, "outline-none")}>
          {title}
        </button>
      ) : (
        <div className={titleClassName}>{title}</div>
      )}
      {children}
    </div>
  );
}

function TrailerPreview({
  candidates,
  emptyText,
  baseDir,
  resolveImageCandidates,
}: {
  candidates: string[];
  emptyText: string;
  baseDir?: string;
  resolveImageCandidates: ResolveImageCandidates;
}) {
  const candidateKey = candidates.join("\u0000");
  const [resolvedCandidates, setResolvedCandidates] = useState<string[]>([]);
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void resolveImageCandidates(candidateKey ? candidateKey.split("\u0000") : [], baseDir).then((resolved) => {
      if (cancelled) return;
      setResolvedCandidates(resolved);
      setCandidateIndex(0);
    });
    return () => {
      cancelled = true;
    };
  }, [baseDir, candidateKey, resolveImageCandidates]);

  const src = resolvedCandidates[candidateIndex];
  if (!src) {
    return <EmptyValue text={emptyText} />;
  }

  const label = candidates[candidateIndex] ?? candidates[0];
  return (
    <div className="space-y-2">
      <TrailerPlayer
        src={src}
        onError={() => setCandidateIndex((index) => index + 1)}
        className="max-h-60 w-full rounded-md"
      />
      <div className="truncate text-xs text-muted-foreground" title={label}>
        {label}
      </div>
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
  resolveImageCandidates,
  imageBaseDir,
}: ChangeDiffViewProps) {
  const t = useT();
  const baseDir = imageBaseDir || getMaintenanceImageBaseDir(entry);
  const sideLabels = { old: t.maintenance.oldCurrent, new: t.maintenance.newPreview };
  const sideCrawlerData = { old: entry?.crawlerData, new: preview?.proposedCrawlerData };

  const renderChangedOptions = (diff: FieldDiff) => {
    const selectedSide = fieldSelections?.[diff.field] ?? getDefaultMaintenanceFieldSelection(diff);
    const hasValue = { old: hasMaintenanceDiffSideValue(diff, "old"), new: hasMaintenanceDiffSideValue(diff, "new") };
    const choose = (side: MaintenanceFieldSelectionSide) => () => onFieldSelectionChange?.(fileId, diff.field, side);
    const chooseMedia = (side: MaintenanceFieldSelectionSide) =>
      hasValue.old && hasValue.new ? choose(side) : undefined;

    return (
      <div className="grid gap-3 md:grid-cols-2">
        {SIDES.map((side) => {
          const selected = selectedSide === side;

          if (diff.kind === "image") {
            const image = resolveMaintenanceDiffImageOption(diff, side);
            return (
              <ImageOptionCard
                key={side}
                {...getImageDisplayProps(diff.field)}
                src={image.src}
                fallbackSrcs={image.fallbackSrcs}
                label={sideLabels[side]}
                selected={selected}
                empty={!hasValue[side]}
                emptyText={side === "old" ? t.maintenance.oldValueEmpty : t.maintenance.newValueEmpty}
                sourceRows={[
                  {
                    label: t.maintenance.imageSource,
                    value: resolveImageSourceValue(sideCrawlerData[side], diff, side, image.src),
                  },
                ]}
                onClick={chooseMedia(side)}
                baseDir={baseDir}
                resolveImageCandidates={resolveImageCandidates}
              />
            );
          }

          if (diff.kind === "imageCollection") {
            const images = resolveMaintenanceDiffImageCollection(diff, side);
            return (
              <OptionCard
                key={side}
                title={images.length > 0 ? `${sideLabels[side]} (${images.length})` : sideLabels[side]}
                selected={selected}
                disabled={!hasValue[side]}
                onClick={chooseMedia(side)}
              >
                {images.length > 0 ? (
                  <SceneImageGallery
                    compact
                    images={images}
                    baseDir={baseDir}
                    resolveImageCandidates={resolveImageCandidates}
                  />
                ) : (
                  <EmptyValue text={side === "old" ? t.maintenance.noLocalStills : t.maintenance.newValueEmpty} />
                )}
              </OptionCard>
            );
          }

          if (diff.field === "trailer_url") {
            const candidates =
              side === "old"
                ? toTrailerCandidates([
                    entry?.assets.trailer,
                    diff.oldValue,
                    entry?.crawlerData?.trailer_source_url,
                    entry?.crawlerData?.trailer_url,
                  ])
                : toTrailerCandidates([
                    diff.newValue,
                    preview?.proposedCrawlerData?.trailer_source_url,
                    preview?.proposedCrawlerData?.trailer_url,
                  ]);
            return (
              <OptionCard
                key={side}
                title={sideLabels[side]}
                selected={selected}
                disabled={!hasValue[side] && candidates.length === 0}
                onClick={chooseMedia(side)}
              >
                <TrailerPreview
                  candidates={candidates}
                  emptyText={side === "old" ? t.maintenance.noTrailer : t.maintenance.newTrailerEmpty}
                  baseDir={baseDir}
                  resolveImageCandidates={resolveImageCandidates}
                />
              </OptionCard>
            );
          }

          return (
            <DiffOption
              key={side}
              title={side === "old" && diff.userEdited ? t.maintenance.oldEdited : sideLabels[side]}
              value={side === "old" ? diff.oldValue : diff.newValue}
              selected={selected}
              disabled={!hasValue[side]}
              onClick={choose(side)}
            />
          );
        })}
      </div>
    );
  };

  const renderUnchangedValue = (diff: FieldDiff) => {
    if (diff.kind === "image") {
      const current = resolveMaintenanceDiffImageOption(diff, "old");
      return (
        <ImageOptionCard
          {...getImageDisplayProps(diff.field)}
          src={current.src}
          fallbackSrcs={current.fallbackSrcs}
          label={t.maintenance.currentValue}
          sourceRows={[
            {
              label: t.maintenance.imageSource,
              value: resolveImageSourceValue(entry?.crawlerData, diff, "old", current.src),
            },
          ]}
          empty={!hasMaintenanceDiffSideValue(diff, "old") && !hasMaintenanceDiffSideValue(diff, "new")}
          emptyText={t.maintenance.currentValueEmpty}
          baseDir={baseDir}
          resolveImageCandidates={resolveImageCandidates}
        />
      );
    }

    if (diff.kind === "imageCollection") {
      const currentImages = resolveMaintenanceDiffImageCollection(diff, "old");
      return currentImages.length > 0 ? (
        <div className="rounded-quiet bg-surface-floating p-3">
          <SceneImageGallery
            compact
            images={currentImages}
            baseDir={baseDir}
            resolveImageCandidates={resolveImageCandidates}
          />
        </div>
      ) : (
        <EmptyValue text={t.maintenance.noStills} className="min-h-20" />
      );
    }

    if (diff.field === "trailer_url") {
      const candidates = toTrailerCandidates([
        entry?.assets.trailer,
        diff.oldValue,
        diff.newValue,
        preview?.proposedCrawlerData?.trailer_source_url ?? entry?.crawlerData?.trailer_source_url,
        preview?.proposedCrawlerData?.trailer_url ?? entry?.crawlerData?.trailer_url,
      ]);
      return candidates.length > 0 ? (
        <div className="rounded-quiet bg-surface-floating p-3">
          <TrailerPreview
            candidates={candidates}
            emptyText={t.maintenance.noTrailer}
            baseDir={baseDir}
            resolveImageCandidates={resolveImageCandidates}
          />
        </div>
      ) : (
        <EmptyValue text={t.maintenance.noTrailer} className="min-h-20" />
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
      ? `${t.domain.maintenanceDiffFields[diff.field]} (${resolveMaintenanceDiffImageCollection(diff, "old").length})`
      : t.domain.maintenanceDiffFields[diff.field];

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
            <p className="text-sm font-medium">{t.maintenance.fetchingDataAndDiff}</p>
          </>
        ) : isPending ? (
          <>
            <Clock className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-medium">{t.maintenance.waitingInQueue}</p>
          </>
        ) : (
          <p className="text-sm font-medium">
            {hasResult ? t.maintenance.noFieldDiffs : t.maintenance.diffsWillShowHere}
          </p>
        )}
      </div>
    );
  }

  const sortedDiffs = trailersLast(diffs);
  const sortedUnchangedDiffs = trailersLast(unchangedDiffs);

  return (
    <div className="space-y-6">
      {sortedDiffs.length > 0 && (
        <div className="space-y-4">{sortedDiffs.map((diff) => renderDiffCard(diff, "changed"))}</div>
      )}

      {sortedUnchangedDiffs.length > 0 && (
        <section className="space-y-4">
          <div className="px-1 text-xs font-medium text-muted-foreground">{t.maintenance.unchangedFields}</div>
          {sortedUnchangedDiffs.map((diff) => renderDiffCard(diff, "unchanged"))}
        </section>
      )}
    </div>
  );
}

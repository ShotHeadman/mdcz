import type { ActorProfile, CrawlerData, FieldDiff, LocalScanEntry, MaintenancePreviewItem } from "@shared/types";
import { ImageOptionCard } from "@/components/ImageOptionCard";
import { SceneImageGallery } from "@/components/SceneImageGallery";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import {
  getDefaultMaintenanceFieldSelection,
  hasMaintenanceDiffSideValue,
  hasMaintenanceFieldValue,
  type MaintenanceFieldSelectionSide,
  resolveMaintenanceDiffImageCollection,
  resolveMaintenanceDiffImageOption,
} from "@/lib/maintenance";
import { cn } from "@/lib/utils";

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
        "min-h-32 rounded-xl border-2 p-4 text-left transition-all",
        selected ? "border-primary ring-2 ring-primary/20" : "border-transparent hover:border-muted-foreground/20",
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

function SceneImageOption({
  title,
  images,
  selected,
  disabled,
  emptyText,
  onClick,
}: {
  title: string;
  images: string[];
  selected: boolean;
  disabled: boolean;
  emptyText: string;
  onClick?: () => void;
}) {
  const clickable = Boolean(onClick) && !disabled;
  const titleNode = <div className="text-xs font-medium text-muted-foreground">{title}</div>;

  return (
    <div
      className={cn(
        "min-h-32 rounded-xl border-2 p-4 text-left transition-all",
        selected ? "border-primary ring-2 ring-primary/20" : "border-transparent hover:border-muted-foreground/20",
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
        <SceneImageGallery images={images} maxThumbnails={8} />
      ) : (
        <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed bg-muted/20 text-sm text-muted-foreground">
          {emptyText}
        </div>
      )}
    </div>
  );
}

export default function ChangeDiffView({
  fileId,
  diffs,
  unchangedDiffs = [],
  hasResult = false,
  entry,
  preview,
  fieldSelections,
  onFieldSelectionChange,
}: {
  fileId: string;
  diffs: FieldDiff[];
  unchangedDiffs?: FieldDiff[];
  hasResult?: boolean;
  entry?: LocalScanEntry;
  preview?: MaintenancePreviewItem;
  fieldSelections?: Record<string, MaintenanceFieldSelectionSide>;
  onFieldSelectionChange?: (fileId: string, field: FieldDiff["field"], side: MaintenanceFieldSelectionSide) => void;
}) {
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
        <div className="grid md:grid-cols-2">
          <ImageOptionCard
            src={oldImage.src}
            fallbackSrcs={oldImage.fallbackSrcs}
            label="旧 (当前)"
            stacked
            selected={selectedSide === "old"}
            empty={!hasOldValue}
            emptyText="旧值为空"
            sourceRows={[
              { label: "图片来源", value: resolveImageSourceValue(entry?.crawlerData, diff, "old", oldImage.src) },
            ]}
            onClick={hasOldValue && hasNewValue ? () => selectField(diff.field, "old") : undefined}
          />
          <ImageOptionCard
            src={newImage.src}
            fallbackSrcs={newImage.fallbackSrcs}
            label="新 (预览)"
            stacked
            selected={selectedSide === "new"}
            empty={!hasNewValue}
            emptyText="新值为空"
            sourceRows={[
              {
                label: "图片来源",
                value: resolveImageSourceValue(preview?.proposedCrawlerData, diff, "new", newImage.src),
              },
            ]}
            onClick={hasOldValue && hasNewValue ? () => selectField(diff.field, "new") : undefined}
          />
        </div>
      );
    }

    if (diff.kind === "imageCollection") {
      const oldImages = resolveMaintenanceDiffImageCollection(diff, "old");
      const newImages = resolveMaintenanceDiffImageCollection(diff, "new");

      return (
        <div className="grid gap-4 md:grid-cols-2">
          <SceneImageOption
            title="旧 (当前)"
            images={oldImages}
            selected={selectedSide === "old"}
            disabled={!hasOldValue}
            emptyText="当前没有本地剧照"
            onClick={hasOldValue && hasNewValue ? () => selectField(diff.field, "old") : undefined}
          />
          <SceneImageOption
            title="新 (预览)"
            images={newImages}
            selected={selectedSide === "new"}
            disabled={!hasNewValue}
            emptyText="新值为空"
            onClick={hasOldValue && hasNewValue ? () => selectField(diff.field, "new") : undefined}
          />
        </div>
      );
    }

    return (
      <div className="grid md:grid-cols-2">
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
      return (
        <ImageOptionCard
          src={current.src}
          fallbackSrcs={current.fallbackSrcs}
          label="当前值"
          stacked
          sourceRows={[
            { label: "图片来源", value: resolveImageSourceValue(entry?.crawlerData, diff, "old", current.src) },
          ]}
          empty={!hasMaintenanceDiffSideValue(diff, "old") && !hasMaintenanceDiffSideValue(diff, "new")}
          emptyText="当前值为空"
        />
      );
    }

    if (diff.kind === "imageCollection") {
      const currentImages = resolveMaintenanceDiffImageCollection(diff, "old");
      return (
        <SceneImageOption title="当前剧照" images={currentImages} selected={false} disabled emptyText="当前没有剧照" />
      );
    }

    return (
      <div className="rounded-xl text-sm leading-relaxed text-foreground whitespace-pre-wrap wrap-break-word">
        {formatValue(diff.oldValue)}
      </div>
    );
  };

  const renderDiffCard = (diff: FieldDiff, mode: "changed" | "unchanged") => {
    return (
      <Card key={`${fileId}-${mode}-${diff.field}`} className="rounded-xl border shadow-sm">
        <CardHeader className="pb-0">
          <CardTitle className="text-sm font-semibold">{diff.label}</CardTitle>
        </CardHeader>
        <CardContent>{mode === "changed" ? renderChangedOptions(diff) : renderUnchangedValue(diff)}</CardContent>
      </Card>
    );
  };

  if (diffs.length === 0 && unchangedDiffs.length === 0) {
    return (
      <div className="flex w-full min-h-96 items-center justify-center text-muted-foreground/60">
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

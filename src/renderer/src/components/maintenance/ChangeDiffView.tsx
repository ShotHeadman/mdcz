import type { ActorProfile, FieldDiff } from "@shared/types";
import { ImageOptionCard } from "@/components/ImageOptionCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { getDefaultMaintenanceFieldSelection, hasMaintenanceFieldValue } from "@/lib/maintenance";
import { cn } from "@/lib/utils";
import { useMaintenanceStore } from "@/store/maintenanceStore";

const IMAGE_FIELDS = new Set(["thumb_url", "poster_url", "fanart_url"]);

const toJoinedProfileNames = (profiles: ActorProfile[]) => profiles.map((profile) => profile.name).join(", ");

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

export default function ChangeDiffView({ entryId, diffs }: { entryId: string; diffs: FieldDiff[] }) {
  const { entrySelections, setFieldSelection } = useMaintenanceStore((state) => ({
    entrySelections: state.fieldSelections[entryId],
    setFieldSelection: state.setFieldSelection,
  }));

  if (diffs.length === 0) {
    return (
      <Card className="rounded-xl border shadow-sm">
        <CardContent className="flex min-h-48 items-center justify-center p-6 text-sm text-muted-foreground">
          执行后将在此显示字段差异。
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {diffs.map((diff) => {
        const hasOldValue = hasMaintenanceFieldValue(diff.oldValue);
        const hasNewValue = hasMaintenanceFieldValue(diff.newValue);
        const selectedSide = entrySelections?.[diff.field] ?? getDefaultMaintenanceFieldSelection(diff);
        const isImageField = IMAGE_FIELDS.has(diff.field);

        return (
          <Card key={`${entryId}-${diff.field}`} className="rounded-xl border shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">{diff.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-2">
                {isImageField ? (
                  <>
                    <ImageOptionCard
                      src={typeof diff.oldValue === "string" ? diff.oldValue : ""}
                      label="旧 (NFO)"
                      selected={selectedSide === "old"}
                      empty={!hasOldValue}
                      emptyText="旧值为空"
                      onClick={
                        hasOldValue && hasNewValue ? () => setFieldSelection(entryId, diff.field, "old") : undefined
                      }
                    />
                    <ImageOptionCard
                      src={typeof diff.newValue === "string" ? diff.newValue : ""}
                      label="新 (网络)"
                      selected={selectedSide === "new"}
                      empty={!hasNewValue}
                      emptyText="新值为空"
                      onClick={
                        hasOldValue && hasNewValue ? () => setFieldSelection(entryId, diff.field, "new") : undefined
                      }
                    />
                  </>
                ) : (
                  <>
                    <DiffOption
                      title="旧 (NFO)"
                      value={diff.oldValue}
                      selected={selectedSide === "old"}
                      disabled={!hasOldValue}
                      onClick={() => setFieldSelection(entryId, diff.field, "old")}
                    />
                    <DiffOption
                      title="新 (网络)"
                      value={diff.newValue}
                      selected={selectedSide === "new"}
                      disabled={!hasNewValue}
                      onClick={() => setFieldSelection(entryId, diff.field, "new")}
                    />
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

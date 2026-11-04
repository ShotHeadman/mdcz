import { formatDuration } from "@mdcz/shared/format";
import type { ActivityEntryDto } from "@mdcz/shared/serverDtos";
import { cn } from "@mdcz/ui";
import { CircleAlert, CircleCheck, CircleDashed, CircleStop, LoaderCircle, type LucideIcon } from "lucide-react";
import { formatDateTime, useT } from "../i18n";

const ACTIVE_STATUSES: ReadonlySet<ActivityEntryDto["status"]> = new Set([
  "queued",
  "discovering",
  "running",
  "paused",
  "stopping",
]);

export const hasActiveActivity = (entries: readonly ActivityEntryDto[]): boolean =>
  entries.some((entry) => ACTIVE_STATUSES.has(entry.status));

// A run fails whenever any file did; one that still added movies reads as partly done rather than failed.
const isPartlyDone = (entry: ActivityEntryDto): boolean =>
  entry.status === "failed" && (entry.counts?.success ?? 0) > 0;

const statusIcon = (status: ActivityEntryDto["status"]): { icon: LucideIcon; className: string } => {
  if (status === "completed") return { icon: CircleCheck, className: "text-emerald-500" };
  if (status === "failed") return { icon: CircleAlert, className: "text-destructive" };
  if (status === "stopped" || status === "interrupted") return { icon: CircleStop, className: "text-amber-500" };
  if (status === "queued" || status === "paused") return { icon: CircleDashed, className: "text-muted-foreground" };
  return { icon: LoaderCircle, className: "animate-spin text-primary" };
};

export interface ActivityTimelineCardProps {
  entries: readonly ActivityEntryDto[];
  /** The maintenance row is the server's current session, so it opens the workbench that shows it. */
  onOpenMaintenance?: () => void;
}

/** One list for scans, scrape runs and maintenance, so what the server did is readable in one place. */
export function ActivityTimelineCard({ entries, onOpenMaintenance }: ActivityTimelineCardProps) {
  const t = useT();
  if (entries.length === 0) return null;

  return (
    <section className="col-span-12">
      <h2 className="mb-4 text-xl font-bold tracking-tight">{t.overview.activity.title}</h2>
      <ol className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {entries.map((entry) => {
          const partlyDone = isPartlyDone(entry);
          const { icon: Icon, className } = partlyDone
            ? { icon: CircleAlert, className: "text-amber-500" }
            : statusIcon(entry.status);
          const duration = entry.durationMs === null ? null : formatDuration(entry.durationMs);
          const details = [
            entry.counts
              ? t.overview.activity.counts(entry.counts.success, entry.counts.failed, entry.counts.skipped)
              : "",
            duration ?? "",
          ].filter(Boolean);
          const rowClassName =
            "flex h-full w-full items-start gap-3 rounded-quiet-lg border border-border/40 bg-surface-low/60 px-4 py-3 text-left";
          const row = (
            <>
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", className)} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-baseline justify-between gap-2">
                  <div className="flex min-w-0 items-baseline gap-1.5">
                    <span className="shrink-0 text-sm font-semibold">{t.overview.activity.kinds[entry.kind]}</span>
                    <span className="truncate text-sm text-muted-foreground" title={entry.target}>
                      {entry.target}
                    </span>
                  </div>
                  <time className="shrink-0 font-numeric text-[11px] text-muted-foreground" dateTime={entry.updatedAt}>
                    {formatDateTime(entry.updatedAt)}
                  </time>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {[
                    partlyDone ? t.overview.activity.partlyDone : t.overview.activity.statuses[entry.status],
                    ...details,
                  ].join(" · ")}
                </div>
                {entry.error ? <div className="mt-1 break-words text-xs text-destructive">{entry.error}</div> : null}
              </div>
            </>
          );
          return (
            <li key={`${entry.kind}:${entry.id}`}>
              {entry.kind === "maintenance" && onOpenMaintenance ? (
                <button
                  type="button"
                  className={cn(rowClassName, "transition-colors hover:border-border/80 hover:bg-surface-low")}
                  onClick={onOpenMaintenance}
                >
                  {row}
                </button>
              ) : (
                <div className={rowClassName}>{row}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

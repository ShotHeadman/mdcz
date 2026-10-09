import { formatDuration } from "@mdcz/shared/format";
import type { ActivityEntryDto } from "@mdcz/shared/serverDtos";
import { cn } from "@mdcz/ui";
import { CircleAlert, CircleCheck, CircleDashed, CircleStop, LoaderCircle, type LucideIcon } from "lucide-react";
import { useT } from "../i18n";

const ACTIVE_STATUSES: ReadonlySet<ActivityEntryDto["status"]> = new Set([
  "queued",
  "discovering",
  "running",
  "paused",
  "stopping",
]);

export const hasActiveActivity = (entries: readonly ActivityEntryDto[]): boolean =>
  entries.some((entry) => ACTIVE_STATUSES.has(entry.status));

const statusIcon = (status: ActivityEntryDto["status"]): { icon: LucideIcon; className: string } => {
  if (status === "completed") return { icon: CircleCheck, className: "text-emerald-500" };
  if (status === "failed") return { icon: CircleAlert, className: "text-destructive" };
  if (status === "stopped" || status === "interrupted") return { icon: CircleStop, className: "text-amber-500" };
  if (status === "queued" || status === "paused") return { icon: CircleDashed, className: "text-muted-foreground" };
  return { icon: LoaderCircle, className: "animate-spin text-primary" };
};

export interface ActivityTimelineCardProps {
  entries: readonly ActivityEntryDto[];
}

/** One list for scans, scrape runs and maintenance, so what the server did is readable in one place. */
export function ActivityTimelineCard({ entries }: ActivityTimelineCardProps) {
  const t = useT();
  if (entries.length === 0) return null;

  return (
    <section className="col-span-12 mt-8">
      <h2 className="mb-6 text-2xl font-bold tracking-tight">{t.overview.activity.title}</h2>
      <ol className="flex flex-col divide-y divide-border/40 rounded-quiet-xl bg-surface-low/60">
        {entries.map((entry) => {
          const { icon: Icon, className } = statusIcon(entry.status);
          const duration = entry.durationMs === null ? null : formatDuration(entry.durationMs);
          const details = [
            entry.counts
              ? t.overview.activity.counts(entry.counts.success, entry.counts.failed, entry.counts.skipped)
              : "",
            duration ?? "",
          ].filter(Boolean);
          return (
            <li className="flex items-start gap-3 px-5 py-3.5" key={`${entry.kind}:${entry.id}`}>
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", className)} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-semibold">{t.overview.activity.kinds[entry.kind]}</span>
                  <span className="truncate text-sm text-muted-foreground" title={entry.target}>
                    {entry.target}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {[t.overview.activity.statuses[entry.status], ...details].join(" · ")}
                </div>
                {entry.error ? <div className="mt-1 break-words text-xs text-destructive">{entry.error}</div> : null}
              </div>
              <time className="shrink-0 text-xs text-muted-foreground" dateTime={entry.updatedAt}>
                {new Date(entry.updatedAt).toLocaleString()}
              </time>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

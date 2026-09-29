import type { DiscoveryProgress } from "@mdcz/shared/directoryTasks";
import { cn } from "@mdcz/ui";
import { FolderOpen, type LucideIcon, TriangleAlert } from "lucide-react";
import { useT } from "../i18n";

export type WorkbenchTaskStateTone = "active" | "muted" | "warning" | "error";

export interface WorkbenchTaskStatePanelProps {
  icon: LucideIcon;
  tone: WorkbenchTaskStateTone;
  title: string;
  hint?: string;
  path?: string | null;
  discovery?: DiscoveryProgress | null;
}

export type WorkbenchTaskStateContent = Pick<WorkbenchTaskStatePanelProps, "icon" | "tone" | "title" | "hint">;

const toneClassName: Record<WorkbenchTaskStateTone, string> = {
  active: "bg-primary/10 text-primary",
  muted: "bg-foreground/5 text-muted-foreground",
  warning: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  error: "bg-destructive/10 text-destructive",
};

export function WorkbenchTaskStatePanel({
  icon: Icon,
  tone,
  title,
  hint,
  path,
  discovery,
}: WorkbenchTaskStatePanelProps) {
  const t = useT();
  const stats = discovery
    ? [
        { label: t.workbench.taskStateVideos, value: discovery.candidates },
        { label: t.workbench.taskStateSkipped, value: discovery.skipped },
      ]
    : [];

  return (
    <div role="status" className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
      <div className={cn("flex h-14 w-14 items-center justify-center rounded-full", toneClassName[tone])}>
        <Icon className={cn("h-6 w-6", tone === "active" && "animate-spin")} strokeWidth={1.5} />
      </div>

      <div className="max-w-md space-y-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {hint ? <p className="text-sm leading-relaxed text-muted-foreground">{hint}</p> : null}
      </div>

      {path ? (
        <div className="flex max-w-full items-center gap-2 rounded-quiet bg-surface-low/70 px-3 py-2 text-muted-foreground">
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="break-all text-left font-mono text-[11px] leading-relaxed">{path}</span>
        </div>
      ) : null}

      {stats.length > 0 ? (
        <dl className="grid w-full max-w-xs grid-cols-2 gap-2">
          {stats.map(({ label, value }) => (
            <div key={label} className="rounded-quiet bg-surface-low/70 px-3 py-3">
              <dd className="font-numeric text-2xl font-semibold tabular-nums">{value}</dd>
              <dt className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{label}</dt>
            </div>
          ))}
        </dl>
      ) : null}

      {tone === "active" && discovery?.currentPath ? (
        <p className="max-w-full truncate font-mono text-[11px] text-muted-foreground/70" title={discovery.currentPath}>
          {discovery.currentPath}
        </p>
      ) : null}

      {discovery?.warnings.length ? (
        <div className="w-full max-w-md space-y-1 rounded-quiet bg-amber-500/10 p-3 text-left text-xs text-amber-700 dark:text-amber-300">
          <div className="flex items-center gap-1.5 font-semibold">
            <TriangleAlert className="h-3.5 w-3.5" />
            {t.workbench.taskStateInaccessiblePaths}
          </div>
          {discovery.warnings.map((warning) => (
            <p key={warning} className="break-all font-mono text-[11px]">
              {warning}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

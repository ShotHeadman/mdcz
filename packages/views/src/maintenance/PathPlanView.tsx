import type { PathDiff } from "@mdcz/shared/types";
import { ArrowRight, CheckCircle2, Route } from "lucide-react";

export interface PathPlanViewProps {
  pathDiff: PathDiff;
}

export function PathPlanView({ pathDiff }: PathPlanViewProps) {
  return (
    <section className="rounded-quiet-lg bg-surface-low/75 p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
        <Route className="h-4 w-4 text-primary" />
        路径变更
      </div>
      <div className="space-y-4">
        {pathDiff.changed ? (
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-start">
            <div className="rounded-quiet bg-surface-floating p-3">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                当前路径
              </div>
              <div className="break-all font-mono text-[11px] leading-relaxed">{pathDiff.currentVideoPath}</div>
            </div>
            <div className="flex items-center justify-center py-4 text-muted-foreground">
              <ArrowRight className="h-4 w-4" />
            </div>
            <div className="rounded-quiet bg-surface-floating p-3 ring-1 ring-primary/10">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                目标路径
              </div>
              <div className="break-all font-mono text-[11px] leading-relaxed">{pathDiff.targetVideoPath}</div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-quiet bg-emerald-50/90 px-3 py-2 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            当前路径已符合整理规则，无需变更。
          </div>
        )}
      </div>
    </section>
  );
}

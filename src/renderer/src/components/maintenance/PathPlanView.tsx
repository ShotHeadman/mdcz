import type { PathDiff } from "@shared/types";
import { ArrowRight, CheckCircle2, Route } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";

export default function PathPlanView({ pathDiff }: { pathDiff: PathDiff }) {
  return (
    <Card className="rounded-xl border shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Route className="h-4 w-4 text-primary" />
          路径变更
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {pathDiff.changed ? (
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-start">
            <div className="rounded-xl border bg-muted/20 p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">当前路径</div>
              <div className="break-all font-mono text-[11px] leading-relaxed">{pathDiff.currentVideoPath}</div>
            </div>
            <div className="flex items-center justify-center py-4 text-muted-foreground">
              <ArrowRight className="h-4 w-4" />
            </div>
            <div className="rounded-xl border bg-primary/5 p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">目标路径</div>
              <div className="break-all font-mono text-[11px] leading-relaxed">{pathDiff.targetVideoPath}</div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            当前路径已符合整理规则，无需变更。
          </div>
        )}
      </CardContent>
    </Card>
  );
}

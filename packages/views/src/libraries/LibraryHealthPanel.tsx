import type { LibraryHealthIssue, LibrarySummaryResponse } from "@mdcz/shared/serverDtos";
import { Button } from "@mdcz/ui";
import { Download } from "lucide-react";
import { useT } from "../i18n";

export interface LibraryHealthPanelProps {
  summary: LibrarySummaryResponse | undefined;
  pendingCount: number;
  onImport: () => void;
  onViewIssue: (issue: LibraryHealthIssue) => void;
  onViewPending: () => void;
}

export function LibraryHealthPanel({
  summary,
  pendingCount,
  onImport,
  onViewIssue,
  onViewPending,
}: LibraryHealthPanelProps) {
  const t = useT();
  if (!summary) return null;
  const issues = (Object.keys(t.library.health.issues) as LibraryHealthIssue[]).filter(
    (issue) => summary.issues[issue] > 0,
  );

  return (
    <div className="mt-4 border-t border-border/40 pt-4">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
          {t.libraries.health.title}
        </span>
        {summary.total > 0 ? (
          <span className="text-xs text-muted-foreground">{t.libraries.health.movies(summary.total)}</span>
        ) : null}
      </div>
      {summary.total === 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">{t.libraries.health.notImported}</span>
          <Button onClick={onImport} size="sm" type="button" variant="secondary">
            <Download className="h-3.5 w-3.5" />
            {t.libraries.health.import}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {issues.length === 0 && pendingCount === 0 ? (
            <span className="text-sm text-muted-foreground">{t.libraries.health.allGood}</span>
          ) : null}
          {issues.map((issue) => (
            <Button
              className="h-7 rounded-full px-3 text-xs font-semibold"
              key={issue}
              onClick={() => onViewIssue(issue)}
              size="sm"
              type="button"
              variant="outline"
            >
              {t.library.health.issues[issue]}
              <span className="font-numeric">{summary.issues[issue]}</span>
            </Button>
          ))}
          {pendingCount > 0 ? (
            <Button
              className="h-7 rounded-full px-3 text-xs font-semibold"
              onClick={onViewPending}
              size="sm"
              type="button"
              variant="outline"
            >
              {t.libraries.health.pending(pendingCount)}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

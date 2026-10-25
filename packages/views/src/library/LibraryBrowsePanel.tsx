import { toErrorMessage } from "@mdcz/shared/error";
import type { LibraryHealthIssue, LibrarySummaryResponse } from "@mdcz/shared/serverDtos";
import { Button, cn } from "@mdcz/ui";
import { ChevronDown, LoaderCircle, Wrench, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useT } from "../i18n";
import { HEALTH_FIX_PRESETS, type LibraryFacetSelection } from "./healthIssues";

const FACET_KINDS = [
  { kind: "actor", key: "actors" },
  { kind: "studio", key: "studios" },
  { kind: "tag", key: "tags" },
] as const;

export interface LibraryBrowseControls {
  libraries: Array<{ id: string; name: string }>;
  libraryId?: string;
  summary?: LibrarySummaryResponse;
  health?: LibraryHealthIssue;
  facet?: LibraryFacetSelection;
  view: "list" | "wall";
  onLibraryChange: (libraryId: string | undefined) => void;
  onHealthChange: (issue: LibraryHealthIssue | undefined) => void;
  onFacetChange: (facet: LibraryFacetSelection | undefined) => void;
  onViewChange: (view: "list" | "wall") => void;
  /** Why the repair cannot start now, such as a running scrape. */
  fixBlockedReason?: string;
  /** Starts a preview that repairs the movies matching `health`. */
  onFix: (issue: LibraryHealthIssue) => Promise<void>;
}

export function LibraryBrowsePanel({
  browse,
  matchCount,
  summaryText,
}: {
  browse: LibraryBrowseControls;
  matchCount: number;
  summaryText?: string;
}) {
  const t = useT();
  const [facetsOpen, setFacetsOpen] = useState(false);
  const [fixing, setFixing] = useState(false);
  const { summary, health, facet } = browse;
  const shownIssues = summary
    ? (Object.keys(t.library.health.issues) as LibraryHealthIssue[]).filter(
        (issue) => (summary.issues[issue] ?? 0) > 0 || health === issue,
      )
    : [];
  const fixable = health !== undefined && HEALTH_FIX_PRESETS[health] !== undefined && matchCount > 0;
  const filtered = health !== undefined || facet !== undefined;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {shownIssues.length > 0 ? (
            <span className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
              {t.library.health.title}
            </span>
          ) : null}
          {shownIssues.map((issue) => {
            const count = summary?.issues[issue] ?? 0;
            const active = health === issue;
            return (
              <Button
                aria-pressed={active}
                className={cn("h-7 rounded-full px-3 text-xs font-semibold", active && "border-primary text-primary")}
                key={issue}
                onClick={() => browse.onHealthChange(active ? undefined : issue)}
                size="sm"
                type="button"
                variant="outline"
              >
                {t.library.health.issues[issue]}
                <span className="font-numeric">{count}</span>
              </Button>
            );
          })}
          {facet ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/5 px-2.5 py-0.5 text-xs text-foreground">
              <span className="text-muted-foreground">
                {t.library.facets[FACET_KINDS.find(({ kind }) => kind === facet.kind)?.key ?? "actors"]}:
              </span>
              <strong>{facet.name}</strong>
            </span>
          ) : null}
          {filtered ? (
            <Button
              className="h-7 gap-1 px-2.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                browse.onHealthChange(undefined);
                browse.onFacetChange(undefined);
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <X className="h-3.5 w-3.5" />
              {t.library.health.clear}
            </Button>
          ) : null}
          {shownIssues.length === 0 && !facet && summaryText ? (
            <span className="font-numeric text-xs text-muted-foreground">{summaryText}</span>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {(shownIssues.length > 0 || facet) && summaryText ? (
            <span className="hidden font-numeric text-xs text-muted-foreground sm:inline">{summaryText}</span>
          ) : null}
          <Button
            aria-expanded={facetsOpen}
            className="h-7 gap-1 px-3 text-xs"
            onClick={() => setFacetsOpen((open) => !open)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t.library.facets.title}
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", facetsOpen && "rotate-180")} />
          </Button>
        </div>
      </div>

      {facetsOpen && summary ? (
        <div className="grid gap-4 rounded-quiet-lg border border-border/40 bg-surface p-4 md:grid-cols-3">
          {FACET_KINDS.map(({ kind, key }) => (
            <div className="min-w-0" key={kind}>
              <h3 className="mb-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
                {t.library.facets[key]}
              </h3>
              {summary.facets[key].length === 0 ? (
                <p className="text-xs text-muted-foreground">{t.library.facets.none}</p>
              ) : (
                <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                  {summary.facets[key].map(({ name, count }) => {
                    const active = facet?.kind === kind && facet.name === name;
                    return (
                      <Button
                        aria-pressed={active}
                        className={cn(
                          "h-6 max-w-full rounded-full px-2.5 text-[11px]",
                          active && "border-primary text-primary",
                        )}
                        key={name}
                        onClick={() => browse.onFacetChange(active ? undefined : { kind, name })}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <span className="truncate">{name}</span>
                        <span className="font-numeric text-muted-foreground">{count}</span>
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {fixable ? (
        <div className="flex flex-wrap items-center gap-3 rounded-quiet-lg border border-border/40 bg-surface-low/60 px-4 py-3">
          {/* A disabled button takes no pointer events, so the reason sits on its wrapper. */}
          <span title={browse.fixBlockedReason}>
            <Button
              disabled={fixing || browse.fixBlockedReason !== undefined}
              onClick={async () => {
                setFixing(true);
                try {
                  await browse.onFix(health);
                } catch (error) {
                  toast.error(toErrorMessage(error), { id: "maintenance" });
                } finally {
                  setFixing(false);
                }
              }}
              size="sm"
              type="button"
            >
              {fixing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
              {t.library.health.fix(matchCount)}
            </Button>
          </span>
          <span className="text-xs text-muted-foreground">{t.library.health.fixHint}</span>
        </div>
      ) : null}
    </section>
  );
}

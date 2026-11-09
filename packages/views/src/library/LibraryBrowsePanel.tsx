import { toErrorMessage } from "@mdcz/shared/error";
import type { LibraryHealthIssue, LibrarySummaryResponse } from "@mdcz/shared/serverDtos";
import { Button, cn } from "@mdcz/ui";
import { ChevronDown, EyeOff, LoaderCircle, RotateCcw, Wrench, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DisabledReason } from "../common";
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
  /** Lists the ignored movies in place of one issue. */
  ignored: boolean;
  facet?: LibraryFacetSelection;
  view: "list" | "wall";
  onLibraryChange: (libraryId: string | undefined) => void;
  onHealthChange: (issue: LibraryHealthIssue | undefined) => void;
  onIgnoredChange: (ignored: boolean) => void;
  onFacetChange: (facet: LibraryFacetSelection | undefined) => void;
  onClear: () => void;
  onViewChange: (view: "list" | "wall") => void;
  /** Why the repair cannot start now, such as a running scrape. */
  fixBlockedReason?: string;
  /** Starts a preview that repairs the movies matching `health`. */
  onFix: (issue: LibraryHealthIssue) => Promise<void>;
  /** Stops counting `health` for the movies the list shows. */
  onIgnore: (issue: LibraryHealthIssue) => Promise<void>;
  /** Counts every issue again for the ignored movies the list shows. */
  onRestore: () => Promise<void>;
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
  const [running, setRunning] = useState<"fix" | "ignore" | "restore">();
  const { summary, health, ignored, facet } = browse;
  const shownIssues = summary
    ? (Object.keys(t.library.health.issues) as LibraryHealthIssue[]).filter(
        (issue) => (summary.issues[issue] ?? 0) > 0 || health === issue,
      )
    : [];
  const ignoredCount = summary?.ignored ?? 0;
  const showIgnored = ignoredCount > 0 || ignored;
  const fixable = health !== undefined && HEALTH_FIX_PRESETS[health] !== undefined;
  const filtered = health !== undefined || ignored || facet !== undefined;
  const run = async (action: NonNullable<typeof running>, task: () => Promise<void>) => {
    setRunning(action);
    try {
      await task();
    } catch (error) {
      toast.error(toErrorMessage(error), { id: action === "fix" ? "maintenance" : "library-health" });
    } finally {
      setRunning(undefined);
    }
  };
  const actionIcon = (action: NonNullable<typeof running>, Icon: typeof Wrench) =>
    running === action ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {shownIssues.length > 0 || showIgnored ? (
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
          {showIgnored ? (
            <Button
              aria-pressed={ignored}
              className={cn(
                "h-7 rounded-full border-dashed px-3 text-xs font-semibold text-muted-foreground",
                ignored && "border-primary text-primary",
              )}
              onClick={() => browse.onIgnoredChange(!ignored)}
              size="sm"
              type="button"
              variant="outline"
            >
              {t.library.health.ignored}
              <span className="font-numeric">{ignoredCount}</span>
            </Button>
          ) : null}
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
              onClick={browse.onClear}
              size="sm"
              type="button"
              variant="ghost"
            >
              <X className="h-3.5 w-3.5" />
              {t.library.health.clear}
            </Button>
          ) : null}
          {shownIssues.length === 0 && !showIgnored && !facet && summaryText ? (
            <span className="font-numeric text-xs text-muted-foreground">{summaryText}</span>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {(shownIssues.length > 0 || showIgnored || facet) && summaryText ? (
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

      {(health !== undefined || ignored) && matchCount > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-quiet-lg border border-border/40 bg-surface-low/60 px-4 py-3">
          {health !== undefined && fixable ? (
            <DisabledReason reason={browse.fixBlockedReason}>
              <Button
                disabled={running !== undefined || browse.fixBlockedReason !== undefined}
                onClick={() => run("fix", () => browse.onFix(health))}
                size="sm"
                type="button"
              >
                {actionIcon("fix", Wrench)}
                {t.library.health.fix(matchCount)}
              </Button>
            </DisabledReason>
          ) : null}
          {health !== undefined ? (
            <Button
              disabled={running !== undefined}
              onClick={() => run("ignore", () => browse.onIgnore(health))}
              size="sm"
              type="button"
              variant={fixable ? "secondary" : "default"}
            >
              {actionIcon("ignore", EyeOff)}
              {t.library.health.ignore(matchCount)}
            </Button>
          ) : (
            <Button
              disabled={running !== undefined}
              onClick={() => run("restore", browse.onRestore)}
              size="sm"
              type="button"
            >
              {actionIcon("restore", RotateCcw)}
              {t.library.health.restore(matchCount)}
            </Button>
          )}
          {health !== undefined ? (
            <span className="flex flex-col text-xs text-muted-foreground">
              {fixable ? <span>{t.library.health.fixHint}</span> : null}
              <span>{t.library.health.ignoreHint}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

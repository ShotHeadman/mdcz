import { toErrorMessage } from "@mdcz/shared/error";
import type { LibraryHealthIssue, LibrarySummaryResponse } from "@mdcz/shared/serverDtos";
import { Button, cn, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mdcz/ui";
import { LayoutGrid, List, LoaderCircle, Wrench, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useT } from "../i18n";
import { HEALTH_FIX_PRESETS, type LibraryFacetSelection } from "./healthIssues";

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
  /** Starts a preview that repairs the movies matching `health`. */
  onFix: (issue: LibraryHealthIssue) => Promise<void>;
}

const ALL_LIBRARIES = "__all__";
const FACET_KINDS = [
  { kind: "actor", key: "actors" },
  { kind: "studio", key: "studios" },
  { kind: "tag", key: "tags" },
] as const;

export function LibraryBrowsePanel({ browse, matchCount }: { browse: LibraryBrowseControls; matchCount: number }) {
  const t = useT();
  const [facetsOpen, setFacetsOpen] = useState(false);
  const [fixing, setFixing] = useState(false);
  const { summary, health, facet } = browse;
  const issues = summary ? (Object.keys(t.library.health.issues) as LibraryHealthIssue[]) : [];
  const fixable = health !== undefined && HEALTH_FIX_PRESETS[health] !== undefined && matchCount > 0;
  const filtered = health !== undefined || facet !== undefined;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {browse.libraries.length > 1 ? (
          <Select
            value={browse.libraryId ?? ALL_LIBRARIES}
            onValueChange={(value) => browse.onLibraryChange(value === ALL_LIBRARIES ? undefined : value)}
          >
            <SelectTrigger aria-label={t.library.libraryAriaLabel} className="h-9 w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_LIBRARIES}>{t.library.allLibraries}</SelectItem>
              {browse.libraries.map((library) => (
                <SelectItem key={library.id} value={library.id}>
                  {library.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <div className="inline-flex rounded-quiet bg-surface-low p-1 shadow-inner sm:ml-auto">
          {(["list", "wall"] as const).map((view) => (
            <Button
              aria-pressed={browse.view === view}
              className={cn(
                "h-7 gap-1.5 rounded-[var(--radius-quiet-sm)] px-3 text-xs font-bold text-muted-foreground",
                browse.view === view && "bg-surface text-foreground shadow-sm",
              )}
              key={view}
              onClick={() => browse.onViewChange(view)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {view === "list" ? <List className="h-3.5 w-3.5" /> : <LayoutGrid className="h-3.5 w-3.5" />}
              {t.library.view[view]}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
          {t.library.health.title}
        </span>
        {issues.map((issue) => {
          const count = summary?.issues[issue] ?? 0;
          const active = health === issue;
          if (count === 0 && !active) return null;
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
        <Button
          aria-expanded={facetsOpen}
          className="ml-auto h-7 px-3 text-xs"
          onClick={() => setFacetsOpen((open) => !open)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {t.library.facets.title}
        </Button>
        {filtered ? (
          <Button
            className="h-7 gap-1 px-3 text-xs"
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
      </div>

      {facet ? (
        <p className="text-xs text-muted-foreground">
          {t.library.facets[FACET_KINDS.find(({ kind }) => kind === facet.kind)?.key ?? "actors"]}:{" "}
          <strong>{facet.name}</strong>
        </p>
      ) : null}

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
          <Button
            disabled={fixing}
            onClick={async () => {
              setFixing(true);
              try {
                await browse.onFix(health);
              } catch (error) {
                toast.error(toErrorMessage(error));
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
          <span className="text-xs text-muted-foreground">{t.library.health.fixHint}</span>
        </div>
      ) : null}
    </section>
  );
}

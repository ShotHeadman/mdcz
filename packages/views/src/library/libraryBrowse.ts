import { LIBRARY_HEALTH_ISSUES, type LibraryHealthIssue, type LibrarySummaryResponse } from "@mdcz/shared/serverDtos";
import { useState } from "react";
import type { LibraryFacetSelection } from "./healthIssues";
import type { LibraryBrowseControls } from "./LibraryBrowsePanel";

/** The library page's filters live in the URL, so the libraries page can link straight to a filtered view. */
export interface LibraryBrowseSearch {
  libraryId?: string;
  health?: LibraryHealthIssue;
  /** The ignored movies, in place of one issue. */
  ignored?: true;
  actor?: string;
  studio?: string;
  tag?: string;
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);

export const parseLibraryBrowseSearch = (search: Record<string, unknown>): LibraryBrowseSearch => ({
  libraryId: text(search.libraryId),
  health: search.ignored === true ? undefined : LIBRARY_HEALTH_ISSUES.find((issue) => issue === search.health),
  ignored: search.ignored === true ? true : undefined,
  actor: text(search.actor),
  studio: text(search.studio),
  tag: text(search.tag),
});

export const toLibraryListScope = ({ libraryId, health, ignored, actor, studio, tag }: LibraryBrowseSearch) => ({
  libraryId,
  health,
  ignored,
  actor,
  studio,
  tag,
});

const facetFromSearch = (search: LibraryBrowseSearch): LibraryFacetSelection | undefined =>
  search.actor
    ? { kind: "actor", name: search.actor }
    : search.studio
      ? { kind: "studio", name: search.studio }
      : search.tag
        ? { kind: "tag", name: search.tag }
        : undefined;

type LibraryView = LibraryBrowseControls["view"];

const VIEW_STORAGE_KEY = "mdcz.library.view";

/** The list or wall is the viewer's preference, not a filter, so it is remembered here rather than in the URL. */
export const useLibraryView = () => {
  const [view, setViewState] = useState<LibraryView>(() =>
    typeof localStorage !== "undefined" && localStorage.getItem(VIEW_STORAGE_KEY) === "wall" ? "wall" : "list",
  );
  const setView = (next: LibraryView) => {
    setViewState(next);
    localStorage.setItem(VIEW_STORAGE_KEY, next);
  };
  return { view, onViewChange: setView };
};

export const createLibraryBrowseControls = (input: {
  search: LibraryBrowseSearch;
  libraries: LibraryBrowseControls["libraries"];
  summary: LibrarySummaryResponse | undefined;
  update: (search: LibraryBrowseSearch) => void;
  view: LibraryView;
  onViewChange: (view: LibraryView) => void;
  fixBlockedReason?: string;
  onFix: LibraryBrowseControls["onFix"];
  onIgnore: LibraryBrowseControls["onIgnore"];
  onRestore: LibraryBrowseControls["onRestore"];
}): LibraryBrowseControls => {
  const { search, update } = input;
  return {
    libraries: input.libraries,
    libraryId: search.libraryId,
    summary: input.summary,
    health: search.health,
    ignored: search.ignored === true,
    facet: facetFromSearch(search),
    view: input.view,
    // Another library has other actors and issues, so its filters start over.
    onLibraryChange: (libraryId) => update({ libraryId }),
    onHealthChange: (health) => update({ ...search, health, ignored: undefined }),
    onIgnoredChange: (ignored) => update({ ...search, health: undefined, ignored: ignored || undefined }),
    onFacetChange: (facet) =>
      update({
        libraryId: search.libraryId,
        health: search.health,
        ignored: search.ignored,
        ...(facet ? { [facet.kind]: facet.name } : {}),
      }),
    onClear: () => update({ libraryId: search.libraryId }),
    onViewChange: input.onViewChange,
    fixBlockedReason: input.fixBlockedReason,
    onFix: input.onFix,
    onIgnore: input.onIgnore,
    onRestore: input.onRestore,
  };
};

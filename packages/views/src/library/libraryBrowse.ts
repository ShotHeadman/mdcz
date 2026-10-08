import { LIBRARY_HEALTH_ISSUES, type LibraryHealthIssue, type LibrarySummaryResponse } from "@mdcz/shared/serverDtos";
import type { LibraryFacetSelection } from "./healthIssues";
import type { LibraryBrowseControls } from "./LibraryBrowsePanel";

/** The library page's filters live in the URL, so the libraries page can link straight to a filtered view. */
export interface LibraryBrowseSearch {
  libraryId?: string;
  health?: LibraryHealthIssue;
  actor?: string;
  studio?: string;
  tag?: string;
  view?: "wall";
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);

export const parseLibraryBrowseSearch = (search: Record<string, unknown>): LibraryBrowseSearch => ({
  libraryId: text(search.libraryId),
  health: LIBRARY_HEALTH_ISSUES.find((issue) => issue === search.health),
  actor: text(search.actor),
  studio: text(search.studio),
  tag: text(search.tag),
  view: search.view === "wall" ? "wall" : undefined,
});

export const toLibraryListScope = ({ libraryId, health, actor, studio, tag }: LibraryBrowseSearch) => ({
  libraryId,
  health,
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

export const createLibraryBrowseControls = (input: {
  search: LibraryBrowseSearch;
  libraries: LibraryBrowseControls["libraries"];
  summary: LibrarySummaryResponse | undefined;
  update: (search: LibraryBrowseSearch) => void;
  onFix: LibraryBrowseControls["onFix"];
}): LibraryBrowseControls => {
  const { search, update } = input;
  return {
    libraries: input.libraries,
    libraryId: search.libraryId,
    summary: input.summary,
    health: search.health,
    facet: facetFromSearch(search),
    view: search.view ?? "list",
    // Another library has other actors and issues, so its filters start over.
    onLibraryChange: (libraryId) => update({ libraryId, view: search.view }),
    onHealthChange: (health) => update({ ...search, health }),
    onFacetChange: (facet) =>
      update({
        libraryId: search.libraryId,
        health: search.health,
        view: search.view,
        ...(facet ? { [facet.kind]: facet.name } : {}),
      }),
    onViewChange: (view) => update({ ...search, view: view === "wall" ? "wall" : undefined }),
    onFix: input.onFix,
  };
};

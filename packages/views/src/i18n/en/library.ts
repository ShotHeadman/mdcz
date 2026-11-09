export const library = {
  filter: {
    all: "All",
    available: "Available",
    unavailable: "Unavailable",
    partial: "Partially Available",
    unchecked: "Unchecked",
  },
  metrics: {
    movies: "Movies",
    files: "Files",
  },
  allLibraries: "All libraries",
  libraryAriaLabel: "Library",
  view: { list: "List", wall: "Poster wall" },
  health: {
    title: "Health",
    issues: {
      missingPoster: "Missing poster",
      missingBackdrop: "Missing backdrop",
      missingSynopsis: "Missing synopsis",
      noNfo: "No NFO",
      duplicate: "Duplicate numbers",
    },
    fix: (count: number) => `Refresh ${count} from sites`,
    fixHint: "Opens a preview of the refreshed metadata. Nothing is written until you apply it.",
    ignored: "Ignored",
    ignore: (count: number) => `Ignore these ${count}`,
    ignoreHint: "Ignored movies no longer count toward health. Restore them from “Ignored”.",
    restore: (count: number) => `Stop ignoring ${count}`,
    fixStarted: (count: number) => `Previewing a refresh of ${count} movies`,
    mixedRoots: "Selected movies span multiple directories. Please filter to a single directory and try again.",
    clear: "Clear filters",
  },
  facets: {
    title: "Browse by",
    actors: "Actors",
    studios: "Studios",
    tags: "Tags",
    none: "Nothing to browse yet",
  },
  searchAriaLabel: "Search media library",
  searchPlaceholder: "Search title, number, actor, or relative path…",
  refresh: "Refresh",
  listAriaLabel: "Media library movie list",
  checkingAvailability: "Checking availability…",
  noConfirmedEntries: (unknownCount: number) => `No confirmed entries yet; ${unknownCount} not yet checked`,
  noMatchingEntries: "No matching entries",
  nothingIndexed: "Nothing indexed yet. Scraped and imported movies appear here.",
  loadMore: "Load more",

  // Entry card
  parts: (count: number) => `${count} parts`,
  partsMissing: (missing: number, total: number) => `${missing} of ${total} parts missing`,
  fileActions: "File actions",
  scrapeInfo: "Scrape Info",
  openFolder: "Open folder",
  removeFromLibrary: "Remove from library",
  multiSelect: "Multi-select",
  selectEntry: (id: string) => `Select ${id}`,
  selectAllLoaded: "Select all loaded",
  selectedCount: (count: number) => `${count} movie(s) selected`,
  availabilityNotChecked: "Availability not yet checked",

  // Availability labels
  availability: {
    partial: "Partially available",
    unavailable: "All unavailable",
  },

  // Delete dialog
  removeDialogTitle: "Remove from Library",
  removeDialogDescription: (movieCount: number, fileCount: number, assetCount: number) =>
    `Will remove ${fileCount} video file record(s) and ${assetCount} asset record(s) for ${movieCount} movie(s). Files on disk are not deleted.`,
  removing: "Removing…",
  confirmRemove: "Confirm Remove",

  // File rows
  fileStatus: {
    available: "Available",
    unavailable: "Unavailable",
    unchecked: "Unchecked",
  },
  copyPath: "Copy path",
  openLocation: "Open location",
  relink: "Relink",
  removeFile: "Remove from library",

  // Relink / remove file dialog
  relinkFileTitle: "Relink File",
  removeFileDescription: "This file record will be removed from the library; other disc parts will be kept.",
  mediaFolderLabel: (name: string) => `Media root: ${name}`,
  newRelativePath: "New relative path",
  confirm: "Confirm",
};

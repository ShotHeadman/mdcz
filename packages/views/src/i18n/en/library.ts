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
    available: "Available",
    unavailable: "Unavailable",
    checking: "Checking",
    unchecked: "Unchecked",
    totalSize: "Total Size",
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
    fixStarted: (count: number) => `Previewing a refresh of ${count} movies`,
    mixedRoots: "These movies live in several media directories. Narrow to one library before fixing.",
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
  loadMore: "Load more",

  // Entry card
  parts: (count: number) => `${count} parts`,
  partsMissing: (missing: number, total: number) => `${missing} of ${total} parts missing`,
  fileActions: "File actions",
  size: "Size",
  updatedTime: "Updated",
  scrapeInfo: "Scrape Info",
  openFolder: "Open folder",
  removeFromLibrary: "Remove from library",
  availabilityNotChecked: "Availability not yet checked",

  // Availability labels
  availability: {
    partial: "Partially available",
    unavailable: "All unavailable",
  },

  // Delete dialog
  removeDialogTitle: "Remove from Library",
  removeDialogDescription: (fileCount: number, assetCount: number) =>
    `Will remove ${fileCount} video file record(s) and ${assetCount} asset record(s).`,
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

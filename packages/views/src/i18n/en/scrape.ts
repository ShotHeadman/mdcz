import type { ScrapeRunStage } from "@mdcz/shared/serverDtos";

export const scrape = {
  stages: {
    discovering: "Scanning video files",
    prepare: "Fetching metadata",
    "check-output": "Checking conflicts",
    execute: "Organizing and archiving",
    search: "Searching",
    download: "Downloading assets",
    completed: "No processable videos found",
  } as Record<ScrapeRunStage, string>,

  // ScrapeStartErrorDialog
  incompleteTitle: "Scrape Task Incomplete",
  incompleteDesc: "Please review task results and resolve the following issues before retrying:",
  understood: "Got it",

  // UncensoredConfirmDialog
  uncensored: {
    title: "Confirm Uncensored Type",
    description: "Please manually confirm the movie type below",
    batchSetTo: "Batch set to:",
    skip: "Skip",
    confirm: "Confirm",
    noItemsToSubmit: "No items to submit",
    options: {
      umr: "Decensored",
      leak: "Leaked",
      uncensored: "Uncensored",
    },
  },

  // ScrapeWorkbenchAdapter
  taskQueued: "Task queued",
  scanningVideoFiles: "Scanning video files",
  stoppingWaitingCurrent: "Stopping, waiting for current file to complete",
  noVideosFound: "No processable videos found",
  allVideosInLibrary: "Every video here is already in the library",
  allVideosInLibraryHint:
    "Folder scrapes skip library movies. To scrape them again, rescrape them from the library or select them under Preview files.",
  taskStopped: "Task stopped",
  taskInterrupted: "Task interrupted",
  preparingTask: "Preparing task",
  taskInterruptedHint: "The task was interrupted before it finished. Rescrape this directory to run it again.",

  // ResultTreeAdapter
  numberCopied: "Code copied",
  copyNumberFailed: "Failed to copy code",
  rescrapeFailed: "Failed to rescrape",
  confirmRemoveGroup: (count: number, number: string) => `Remove ${count} records from the library?\n${number}`,
  confirmRemoveSingle: (path: string) => `Remove this record from the library?\n${path}`,
  operationFailed: "Operation failed",
  unrecognizedNumber: "Unrecognized code",
  copyNumber: "Copy code",
  copyPath: "Copy path",
  rescrape: "Rescrape",
  rescrapeByUrl: "Rescrape by URL",
  rescrapeByNumber: "Rescrape by number (drop pinned page)",
  removeFromLibrary: "Remove from library",
  openSourceFolder: "Open source directory",
  openMetadataFolder: "Open metadata directory",
  editNfo: "Edit NFO",
  play: "Play",
  metrics: {
    total: "Total",
    success: "Success",
    failed: "Failed",
  },
  rescrapeByUrlFailed: "Failed to rescrape by URL",

  // DetailPanelAdapter
  emptyMessage: "Select an item to view details",
  loadNfoFailed: (error: string) => `Failed to load NFO: ${error}`,
  checkFormContent: "Please check form content",
  nfoSaved: "NFO saved",
  saveNfoFailed: (error: string) => `Failed to save NFO: ${error}`,
  discardNfoChanges: "Discard unsaved NFO changes?",
  discardPosterChanges: "Discard unsaved thumbnail changes?",
  saveCoverFailed: (error: string) => `Failed to save thumbnail: ${error}`,
};

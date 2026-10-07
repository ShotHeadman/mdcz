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
  launch: {
    selection: "Selected file scraping started",
    singleFile: "Single file scrape task started",
    retry: "Retry started",
    manualUrl: "Manual URL scrape started",
  },

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
  taskStopped: "Task stopped",
  taskInterrupted: "Task interrupted",
  preparingTask: "Preparing task",
  taskInterruptedHint: "The task was interrupted before it finished. Rescrape this directory to run it again.",

  // ResultTreeAdapter
  numberEmpty: "Movie code is empty",
  numberCopied: "Code copied",
  copyNumberFailed: "Failed to copy code",
  rescrapeFailed: "Failed to rescrape",
  confirmRemoveGroup: (count: number, number: string) => `Remove ${count} records from the library?\n${number}`,
  confirmRemoveSingle: (path: string) => `Remove this record from the library?\n${path}`,
  removedSuccess: "Removed from the library",
  operationFailed: "Operation failed",
  noOpenablePath: "No openable file path",
  openFolderFailed: (error: string) => `Failed to open directory: ${error}`,
  unrecognizedNumber: "Unrecognized code",
  copyNumber: "Copy code",
  pathCopied: "Path copied",
  copyPathFailed: "Failed to copy path",
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
  selectItemFirst: "Please select an item first",
  loadNfoFailed: (error: string) => `Failed to load NFO: ${error}`,
  checkFormContent: "Please check form content",
  nfoSaved: "NFO saved",
  saveNfoFailed: (error: string) => `Failed to save NFO: ${error}`,
  discardNfoChanges: "Discard unsaved NFO changes?",
  discardPosterChanges: "Discard unsaved thumbnail changes?",
  coverSaved: "Thumbnail saved",
  saveCoverFailed: (error: string) => `Failed to save thumbnail: ${error}`,
};

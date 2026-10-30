export const workbench = {
  /** Keyed by the task already running. */
  taskConflict: {
    scrape: "A scrape is currently running. Stop it before starting maintenance or repair.",
    maintenance: "Maintenance is currently running. Stop it before starting a new scrape.",
  },

  // Return button
  returnDialogDescription: "Returning will clear the current workbench content. Are you sure you want to continue?",
  returnDialogTitle: "Return to workbench setup",
  confirmReturn: "Confirm Return",

  // Frame actions
  analyzingFiles: "Analyzing files…",
  runSummary: (succeeded: number, failed: number, skipped: number, duration: string | null) =>
    [`${succeeded} succeeded`, `${failed} failed`, `${skipped} skipped`, duration ?? ""].filter(Boolean).join(" · "),
  resumeScrape: "Resume scrape task",
  pauseScrape: "Pause scrape task",
  resume: "Resume",
  pause: "Pause",
  stopScrape: "Stop scrape task",
  stop: "Stop",
  scrapeReturnDescription:
    "Returning will clear the current scrape results and return to the workbench setup. Are you sure you want to continue?",
  rescrapeDirectory: "Rescrape this directory",
  taskStateVideos: "Videos",
  taskStateSkipped: "Skipped",
  taskStateInLibrary: "In library",
  taskStateInaccessiblePaths: "Some paths are inaccessible",
  retryFailed: "Retry failed",
  actorSyncQueued: (servers: string) => `${servers} · Actor sync queued`,
  actorSyncWaiting: (servers: string, found: number, total: number) =>
    `${servers} · Waiting for scan (actors ${found}/${total})`,
  actorSyncSyncing: (servers: string, done: number, total: number) => `${servers} · Syncing actors ${done}/${total}`,
  actorSyncSummary: (synced: number, notFound: number, failed: number) =>
    [
      `Actor sync completed: ${synced} updated`,
      notFound ? `${notFound} not found` : "",
      failed ? `${failed} failed` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  actorSyncCancelled: "Actor sync cancelled",
  actorSyncScanMissed: (servers: string) =>
    `${servers} didn't detect the new actors in time. Check that its media library paths match MDCz.`,
  cancelActorSync: "Cancel",

  // Setup view
  browse: "Browse",
  scanningStatus: (scope: string, seconds: number) => `Scanning (${scope}) · Elapsed ${seconds}s`,
  scopeRecursive: "Including subdirectories",
  scopeCurrentOnly: "Current directory only",
  selectedFilesSummary: (count: number, size: string) => `${count} file(s) selected · ${size}`,
  startWholeDirectoryTitle: "Process all videos in the directory?",
  startWholeDirectoryDescription: (scanDir: string, scope: string) =>
    `Files have not been previewed, so every video in ${scanDir} will be processed (${scope}). To pick files, click "Preview files" first.`,
  backToConfig: "Back to config",
  previewFiles: "Preview files",
  startScrape: "Start Scraping",
  startMaintenance: "Start Maintenance",
  stepsNavAriaLabel: "Workbench steps",
  step01: "01 Configure Directories",
  step02: "02 Preview Files",
  optional: "Optional",
  scanDirLabel: "Scan Directory",
  includeSubdirs: "Include subdirectories",
  scanDirPlaceholder: "Select media directory to scan",
  loadingConfig: "Loading config…",
  libraryLabel: "Library",
  libraryPlaceholder: "Choose a library",
  manageLibraries: "Manage libraries",
  noLibraries: "Create a library first to define the output directory and placement rules.",
  createLibrary: "Create library",
  inaccessiblePathsWarning: (count: number) => `Some paths are inaccessible; ${count} skipped`,
  selectVisibleFilesAriaLabel: "Select currently visible files",
  refreshFiles: "Refresh files",
  alreadyInLibrary: "Already in library",
  selectedOfTotalFiles: (selected: number, total: number) => `${selected} / ${total} file(s) selected`,
  searchFilesAriaLabel: "Search files",
  searchFilesPlaceholder: "Search files…",
  clearSearchAriaLabel: "Clear search",
  totalSize: (size: string) => `Total size ${size}`,
  showingItems: (count: number) => `Showing ${count} item(s)`,
  colFile: "File",
  colType: "Type",
  colSize: "Size",
  scanFailed: "Scan Failed",
  previewHint: 'Select directory, then click "Preview files" to view processable media files.',
  noVideosFoundRecursive: "No supported videos found",
  noVideosFoundCurrent: 'No videos found in current directory; you may check "Include subdirectories"',
  supportedTypes: (types: string) => `Supported types: ${types}`,
  noFilesMatching: (query: string) => `No files matching "${query}"`,
  clearSearch: "Clear search",

  // Setup adapter
  cancelScanFailed: (error: string) => `Failed to cancel scan: ${error}`,
  selectScanDirFailed: (error: string) => `Failed to select scan directory: ${error}`,
  enterFullPath: "Please enter a full path",

  // Ports
};

export const desktop = {
  // Person sync & connection
  diagnosingServerConnection: (server: string) => `Diagnosing ${server} connection…`,
  serverDiagnosticPassed: (server: string) => `${server} connection diagnostic passed`,
  serverConnectivityTestFailed: (server: string, error: string) => `${server} connectivity test failed: ${error}`,
  syncingActorInfo: (server: string) => `Syncing ${server} actor metadata…`,
  actorInfoSyncCompleted: (server: string) => `${server} metadata sync completed`,
  actorInfoSyncFailed: (server: string, error: string) => `${server} metadata sync failed: ${error}`,
  syncingActorPhotos: (server: string) => `Syncing ${server} actor photos…`,
  actorPhotosSyncCompleted: (server: string) => `${server} photo sync completed`,
  actorPhotosSyncFailed: (server: string, error: string) => `${server} photo sync failed: ${error}`,
  jellyfinInfoMissing: "Only fill in missing actor bios and basic details.",
  jellyfinInfoAll: "Update actor bios and basic details according to current scraping results.",
  jellyfinPhotoMissing: "Only add photos for actors without photos.",
  jellyfinPhotoAll: "Resync actor photos according to current scraping results.",
  embyInfoMissing: "Only fill in missing actor bios and basic details, preserving unchanged fields.",
  embyInfoAll: "Update actor bios and basic details according to current scraping results and write back to Emby.",
  embyPhotoMissing: "Only add photos for actors without photos.",
  embyPhotoAll: "Resync actor photos according to current scraping results.",
  photoAdminNotice:
    "Uploading person photos usually requires an admin API key. If 401 or 403 is returned, retry using an admin API key.",

  // Amazon poster tool
  amazonScanNoItems: "Scan complete. No processable NFO items found.",
  amazonScanCompleted: (count: number) => `Scan complete: found ${count} items.`,
  amazonScanFailed: (error: string) => `Amazon poster scan failed: ${error}`,
  noAmazonPosterSelected: "No Amazon posters selected.",
  postersReplacedCount: (count: number) => `Replaced ${count} poster files.`,
  replaceCompletedSuccess: (success: number, failed: number) =>
    `Replace complete: ${success} succeeded, ${failed} failed.`,
  replaceFailed: (error: string) => `Poster replacement failed: ${error}`,

  // Batch NFO translator tool
  enterScanDirectory: "Please enter a media directory to scan",
  scanCompletedNoItems: "Scan complete. No NFO items found to translate.",
  scanCompletedSummary: (items: number, fields: number) =>
    `Scan complete: found ${items} items with ${fields} pending fields.`,
  scanFailed: (error: string) => `Batch translate scan failed: ${error}`,
  batchTranslateCompleted: (success: number, total: number, partial: number) =>
    `Batch translation complete: ${success}/${total} succeeded, ${partial} partial.`,
  batchTranslateCompletedWithErrors: (success: number, partial: number, failed: number) =>
    `Batch translation complete: ${success} succeeded, ${partial} partial, ${failed} failed.`,

  // Crawler tester tool
  selectSite: "Please select a site",
  enterMovieNumber: "Please enter a movie number",
  testSucceededWithTime: (time: string) => `Test succeeded (${time}s)`,
  noDataRetrieved: "No data retrieved",
  crawlerTestFailed: (error: string) => `Crawler test failed: ${error}`,

  // Single file scraper tool
  enterFilePath: "Please enter a file path",
  startingSingleScrape: "Starting single-file scrape task…",
  singleScrapeStartFailed: (error: string) => `Failed to start single-file scrape: ${error}`,
  fileSelectFailed: (error: string) => `File selection failed: ${error}`,

  // Symlink manager tool
  enterSourceAndDest: "Please enter source and destination directories",
  startingSymlinkTask: "Starting symlink creation task…",
  symlinkTaskStartFailed: (error: string) => `Failed to start symlink creation: ${error}`,

  // Shortcuts
  stoppingScrape: "Stopping scrape task…",
  stopFailed: (error: string) => `Stop failed: ${error}`,
  startFailed: (error: string) => `Start failed: ${error}`,
  selectResultFirst: "Please select a result item first",
  retryFailed: (error: string) => `Retry failed: ${error}`,
  desktopPlaybackOnly: "Playback is only supported in the desktop client",

  // Playback & ports
  playbackOnlyOnDesktop: "Playback is only available in desktop mode",
  playbackFailed: "Playback failed",
  missingLocalVideoPath: "Missing local video path",
  selectFileToScrape: "Please select a file to scrape",

  // Crash fallback
  renderErrorTitle: "Rendering error",
  renderErrorDescription:
    "The page failed to render properly. You can retry the current view, or reload the application if the issue persists.",
  retryView: "Retry view",
  reloadApp: "Reload app",

  // Recent acquisitions & overview
  removedFromRecent: "Removed from recent acquisitions",
  removeFromRecentFailed: "Failed to remove from recent acquisitions",
  noKnownPath: "No known path",
  fileMovedOrDeleted: "File has been moved or deleted; unable to locate original position",
  cannotOpenFileExplorer: "Unable to open system file manager",
  recentAcquisitions: "Recent acquisitions",

  // Scrape completion dialog
  updatedUncensoredTypes: (count: number) => `Updated uncensored type for ${count} files`,

  // File filters
  mediaFiles: "Media files",

  // Manual API
  noScrapeTaskToRetry: "No scrape task available to retry",
  scrapeTaskInProgress: "Scrape task is currently running. Please wait for it to finish before retrying.",

  // About route
  readAboutFailed: (error: string) => `Failed to read about info: ${error}`,
  saveFailed: (error: string) => `Save failed: ${error}`,
  enableDebug: "Enable debug",

  // Updates
  updateCheckNow: "Check now",
  updateChecking: "Checking for updates…",
  updateLatest: "You are on the latest version",
  updateAvailable: (version: string) => `MDCz v${version} is available`,
  updateDownload: "Download",
  updateOpenDownload: "Get from GitHub",
  updateDownloading: (version: string, percent: number) => `Downloading v${version}… ${percent}%`,
  updateDownloaded: (version: string) => `v${version} is ready. It installs when MDCz restarts or quits.`,
  updateInstall: "Restart now",
  updateFailed: (error: string) => `Update failed: ${error}`,

  // Library route
  removedFromLibrary: "Removed from library",

  // Logs route
  logsEmpty: "No logs yet. Logs will appear here after a scrape or maintenance task starts.",
  logsNoMatch: "No matching logs found.",
  autoScrollEnabled: "Auto-scroll enabled",
  autoScrollDisabled: "Auto-scroll disabled",
  clearAllLogsTitle: "Clear all logs",
  clearAllLogsDescription: "Are you sure you want to clear all log entries?",
  confirmClear: "Confirm clear",
  logsCleared: "Logs cleared successfully",

  // Workbench route
  stopScrapeFirst: "Please stop the current scrape task first",
  stopMaintenanceFirst: "Please stop the current maintenance task first",
  taskSubmitted: "Task submitted",
  maintenanceRunningWarning:
    "Maintenance mode is currently running and normal scraping cannot start. Please stop the maintenance task first.",
  noMediaToScrape: "No media files found to scrape in the current directory",
  scrapeRunningWarning:
    "Scraping is currently running and maintenance mode cannot start. Please stop the scrape task first.",
  confirmStopScrape: "Are you sure you want to stop scraping?",
  stopping: "Stopping…",
  stopScrapeFailed: "Failed to stop",
  taskPaused: "Task paused",
  pauseFailed: "Failed to pause",
  taskResumed: "Task resumed",
  resumeFailed: "Failed to resume",
  noFailedItemsToRetry: "No failed items available to retry",
  confirmBatchRetry: (count: number) => `Are you sure you want to retry ${count} failed items?`,
};

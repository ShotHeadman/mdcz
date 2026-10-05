export const web = {
  // Browser file
  fileUnavailable: "The selected file is unavailable. Please select again.",

  // Auth / Login
  adminLogin: "Admin Login",
  enterAdminPassword: "Enter administrator password",
  password: "Password",
  loggingIn: "Logging in…",
  login: "Log in",

  // Setup
  initAdminTitle: "Initialize Administrator Account",
  passwordsDoNotMatch: "Passwords do not match",
  initAdminDescription: "After creating an administrator account, you can configure your media library.",
  adminPassword: "Administrator Password",
  adminPasswordPlaceholder: "Enter new password (no format restrictions)",
  confirmPassword: "Confirm Password",
  confirmPasswordPlaceholder: "Re-enter new password to confirm",
  completingInit: "Completing setup…",
  completeInit: "Complete Setup",

  // Scrape detail
  scrapeResultNotFound: "Scrape result not found",

  // Overview
  goToWorkbench: "Go to Workbench",
  goToSettings: "Go to Settings",
  recentAcquisitions: "Recent acquisitions",
  removedFromRecent: "Removed from recent acquisitions",

  // Settings services
  copiedWatermarkDir: "Server watermark directory path copied.",
  browserCannotOpenFolder: "The browser cannot open the server folder. Please copy the server path above.",
  copyServerPath: "Copy server path",

  // Library
  removedFromLibrary: "Removed from library",

  // Tools
  openWorkbench: "Open Workbench",
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

  // Workbench
  stopScrapeConfirm: "Are you sure you want to stop scraping?",
  retryFailedConfirm: (count: number) => `Are you sure you want to retry ${count} failed items?`,
  stopScrapeFirst: "Please stop the current scrape task first",
  taskSubmitted: "Task submitted",
  selectedScrapeStarted: "Scraping started for selected files",
  noControllableScrapeTask: "No controllable scrape task currently running",
  taskPaused: "Task paused",
  pauseFailed: (error: string) => `Pause failed: ${error}`,
  taskResumed: "Task resumed",
  resumeFailed: (error: string) => `Resume failed: ${error}`,
  stopping: "Stopping…",
  stopFailed: (error: string) => `Stop failed: ${error}`,
  noFailedItemsToRetry: "No failed items available to retry",
  updatedUncensoredTypes: "Updated uncensored types",
  taskRefreshFailed: (error: string) => `Failed to refresh task status: ${error}`,

  // Logs
  logsEmpty: "No logs yet. Logs will appear here after a scrape or maintenance task starts.",
  logsNoMatch: "No matching logs found.",
  autoScrollEnabled: "Auto-scroll enabled",
  autoScrollDisabled: "Auto-scroll disabled",
  clearAllLogsTitle: "Clear all logs",
  clearAllLogsDescription: "Are you sure you want to clear all log entries?",
  confirmClear: "Confirm clear",
  logsCleared: "Logs cleared successfully",

  // Status badges & types
  taskStatus: {
    queued: "Queued",
    running: "Running",
    completed: "Completed",
    failed: "Failed",
    paused: "Paused",
    stopping: "Stopping",
  },
  taskType: {
    maintenance: "Maintenance",
    scan: "Scan",
    scrape: "Scrape",
  },

  // Ports
  missingScrapeResultId: "Missing scrape result ID",
  selectFileToScrape: "Please select a file to scrape",
  noScrapeTaskToRetry: "No scrape task available to retry",
  noControllableMaintenanceSession: "No controllable maintenance session",
  selectFileToMaintain: "Please select a file to maintain",
};

export const web = {
  // Browser file
  fileUnavailable: "The selected file is unavailable. Please select again.",

  // Auth / Login
  adminLogin: "Admin Login",
  enterAdminPassword: "Enter administrator password",
  password: "Password",
  loggingIn: "Logging in…",
  login: "Log in",
  incorrectPassword: "Incorrect administrator password",

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
  recentAcquisitions: "Recent acquisitions",

  // Settings services
  copiedWatermarkDir: "Server watermark directory path copied.",
  browserCannotOpenFolder: "The browser cannot open the server folder. Please copy the server path above.",
  copyServerPath: "Copy server path",

  // Library

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
  pauseFailed: (error: string) => `Pause failed: ${error}`,
  resumeFailed: (error: string) => `Resume failed: ${error}`,
  stopping: "Stopping…",
  stopFailed: (error: string) => `Stop failed: ${error}`,
  taskRefreshFailed: (error: string) => `Failed to refresh task status: ${error}`,

  // Logs
  logsEmpty: "No logs yet. Logs will appear here after a scrape or maintenance task starts.",
  logsNoMatch: "No matching logs found.",
  clearAllLogsTitle: "Clear all logs",
  clearAllLogsDescription: "Are you sure you want to clear all log entries?",
  confirmClear: "Confirm clear",

  // Status badges & types

  // Ports
  missingVideoFile: "This item has no video file",
  selectFileToScrape: "Please select a file to scrape",
  noScrapeTaskToRetry: "No scrape task available to retry",
  noControllableMaintenanceSession: "No controllable maintenance session",
  selectFileToMaintain: "Please select a file to maintain",
};

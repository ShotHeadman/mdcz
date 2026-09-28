export const overview = {
  hero: {
    startAction: "Go to workbench",
    setupAction: "Go to settings",
    title: "Start scraping",
    description:
      "Open the workbench to extract metadata. Current output overview will stay updated once scraping finishes.",
    loadFailed: "Failed to load",
    waitingFirstScrape: "Waiting for first scrape",
    notConfigured: "Not configured",
  },
  maintenance: {
    title: "Maintenance",
    description:
      "Preview directory changes, repair metadata, and handle batch reorganizations to keep the output directory clean and consistent.",
    action: "Go to workbench",
  },
  recent: {
    removeDialogTitle: "Remove from recent acquisitions",
    loadFailedTitle: "Failed to load recent acquisitions",
    loadFailedDescription: "Please retry later or check application logs.",
    emptyTitle: "No scrape records",
    emptyDescription: "Recently acquired movies will appear here once scraping completes.",
    unknownActor: "Unknown actor",
    retry: "Retry",
    confirm: "Confirm",
    removeAriaLabel: (title: string) => `Remove ${title} from recent acquisitions`,
    openFolderAriaLabel: (title: string) => `Open folder for ${title}`,
  },
};

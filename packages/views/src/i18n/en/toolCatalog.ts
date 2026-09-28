import type { ToolId } from "@mdcz/shared/toolCatalog";

export interface ToolText {
  title: string;
  description: string;
  detailTitle: string;
  detailDescription: string;
}

export const toolCatalog: Record<ToolId, ToolText> = {
  "single-file-scraper": {
    title: "Single-file scrape",
    description: "Quickly start a metadata scrape for one media file.",
    detailTitle: "Single-file scrape",
    detailDescription: "Enter a file path to process that video and submit it to the background task queue.",
  },
  "crawler-tester": {
    title: "Crawler tester",
    description: "Check that site rules, connectivity and scraped results behave as expected.",
    detailTitle: "Crawler tester",
    detailDescription:
      "Pick a site and a movie code to verify its rules, browser connection and field extraction right away.",
  },
  "amazon-poster": {
    title: "Amazon poster upgrade",
    description: "Scan a media directory and fetch higher-quality posters for display.",
    detailTitle: "Amazon poster upgrade",
    detailDescription: "Scan scraped entries and pull better-suited portrait posters from Amazon.co.jp.",
  },
  "media-library-tools": {
    title: "Emby / Jellyfin maintenance",
    description: "Complete person profiles and check library status to keep media information consistent.",
    detailTitle: "Person tools",
    detailDescription: "Diagnose the connection and sync person photos and overviews.",
  },
  "symlink-manager": {
    title: "Symlink manager",
    description: "Create or verify directory mappings in bulk to keep the library structure tidy.",
    detailTitle: "Symlink manager",
    detailDescription:
      "Mirror a file layout between directories, useful for separating raw storage from the media display directory.",
  },
  "batch-nfo-translator": {
    title: "Batch NFO translation",
    description: "Scan fields that need translation and write back titles, plots and other text in bulk.",
    detailTitle: "Batch NFO translation",
    detailDescription:
      "Scan NFO files in the library, translate titles and plots with the current LLM settings and write them back.",
  },
};

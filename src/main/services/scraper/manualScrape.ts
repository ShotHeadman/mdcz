import type { Website } from "@shared/enums";

export interface ManualScrapeOptions {
  site: Website;
  detailUrl?: string;
}

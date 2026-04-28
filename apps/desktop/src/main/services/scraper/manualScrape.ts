import type { Website } from "@mdcz/shared/enums";

export interface ManualScrapeOptions {
  site: Website;
  detailUrl?: string;
}

import type { Website } from "@mdcz/shared/enums";

import type { SiteAdapterConstructor } from "./base/types";

export type CrawlerConstructor = SiteAdapterConstructor;

export interface CrawlerRegistration {
  site: Website;
  crawler: CrawlerConstructor;
}

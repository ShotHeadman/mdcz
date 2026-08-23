import type { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import type { CrawlerOptions } from "./base/types";

export type RuntimeCrawlerFailureReason =
  | "not_found"
  | "region_blocked"
  | "login_wall"
  | "timeout"
  | "parse_error"
  | "unknown";

export interface RuntimeCrawlerInput {
  number: string;
  site: Website;
  options?: CrawlerOptions;
}

export type RuntimeCrawlerResult =
  | { success: true; data: CrawlerData }
  | { success: false; error: string; failureReason?: RuntimeCrawlerFailureReason; cause?: unknown };

export interface RuntimeCrawlerResponse {
  input: RuntimeCrawlerInput;
  result: RuntimeCrawlerResult;
  elapsedMs: number;
}

export interface RuntimeSiteCooldown {
  cooldownUntil: number;
  remainingMs: number;
}

export interface RuntimeCrawlerProvider {
  crawl(input: RuntimeCrawlerInput): Promise<RuntimeCrawlerResponse>;
  getSiteCooldown(site: Website): RuntimeSiteCooldown | null | undefined;
}

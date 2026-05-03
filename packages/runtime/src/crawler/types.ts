import type { Website } from "@mdcz/shared/enums";
import type { R18MetadataLanguage } from "@mdcz/shared/r18";
import type { CrawlerData } from "@mdcz/shared/types";

export type RuntimeCrawlerFailureReason =
  | "not_found"
  | "region_blocked"
  | "login_wall"
  | "timeout"
  | "parse_error"
  | "unknown";

export interface RuntimeCrawlerOptions {
  timeoutMs?: number;
  cookies?: string;
  referer?: string;
  userAgent?: string;
  apiToken?: string;
  detailUrl?: string;
  r18MetadataLanguage?: R18MetadataLanguage;
  signal?: AbortSignal;
}

export interface RuntimeCrawlerInput {
  number: string;
  site: Website;
  options?: RuntimeCrawlerOptions;
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

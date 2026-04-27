import type { SiteRequestConfig } from "@main/services/network";
import type { Website } from "@shared/enums";
import type { R18MetadataLanguage } from "@shared/r18";
import type { CrawlerData } from "@shared/types";
import type { FetchGateway } from "../FetchGateway";

export interface CrawlerOptions {
  timeoutMs?: number;
  cookies?: string;
  referer?: string;
  userAgent?: string;
  apiToken?: string;
  detailUrl?: string;
  r18MetadataLanguage?: R18MetadataLanguage;
  signal?: AbortSignal;
}

export interface CrawlerInput {
  number: string;
  site: Website;
  options?: CrawlerOptions;
}

export type Context = {
  number: string;
  site: Website;
  options: CrawlerOptions;
} & Record<string, unknown>;

export interface CrawlerSuccessResult {
  success: true;
  data: CrawlerData;
}

export interface CrawlerErrorResult {
  success: false;
  error: string;
  failureReason?: FailureReason;
  cause?: unknown;
}

export type CrawlerResult = CrawlerSuccessResult | CrawlerErrorResult;

export interface SearchPageResolution {
  detailUrl: string;
  reuseSearchDocument?: boolean;
}

export type FailureReason = "not_found" | "region_blocked" | "login_wall" | "timeout" | "parse_error" | "unknown";

export interface CrawlerResponse {
  input: CrawlerInput;
  result: CrawlerResult;
  elapsedMs: number;
}

export interface SiteAdapter {
  site(): Website;
  crawl(input: CrawlerInput): Promise<CrawlerResponse>;
}

export interface AdapterDependencies {
  gateway: FetchGateway;
}

export interface SiteAdapterConstructor {
  new (dependencies: AdapterDependencies): SiteAdapter;
  readonly siteRequestConfigs?: readonly SiteRequestConfig[];
}

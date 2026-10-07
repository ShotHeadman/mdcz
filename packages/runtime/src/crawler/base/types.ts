import type { SiteRequestConfig } from "@mdcz/runtime/network";
import type { Website } from "@mdcz/shared/enums";
import type { R18MetadataLanguage } from "@mdcz/shared/r18";
import type { FailureReason } from "@mdcz/shared/siteResults";
import type { CrawlerData } from "@mdcz/shared/types";
import type { ContentType } from "../../scrape/utils/movieClassification";
import type { FetchGateway } from "../FetchGateway";

export interface CrawlerOptions {
  baseUrl?: string;
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
  reason: FailureReason;
  httpStatus?: number;
  retryAfterMs?: number;
  cause?: unknown;
}

export type CrawlerResult = CrawlerSuccessResult | CrawlerErrorResult;

export interface SearchPageResolution {
  detailUrl: string;
  reuseSearchDocument?: boolean;
}

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
  /** Maker sites answer only the numbers this matches. */
  readonly numberPattern?: RegExp;
  /** Catalog sites answer numbers of these content types; required when `numberPattern` is absent. */
  readonly contentTypes?: readonly ContentType[];
}

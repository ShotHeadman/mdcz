import { findSiteError, SiteError } from "@mdcz/runtime/network";
import { runtimeLoggerService, toErrorMessage } from "@mdcz/runtime/shared";
import type { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import { type CheerioAPI, load } from "cheerio";
import type { FetchGateway, FetchOptions } from "../FetchGateway";
import { verifyMovieNumber } from "./identity";

import type {
  AdapterDependencies,
  Context,
  CrawlerErrorResult,
  CrawlerInput,
  CrawlerResponse,
  CrawlerResult,
  SearchPageResolution,
  SiteAdapter,
} from "./types";

const DEFAULT_OPTIONS = {
  timeoutMs: 10_000,
  cookies: undefined,
  referer: undefined,
  userAgent: undefined,
  apiToken: undefined,
};

interface DetailRequest {
  detailUrl: string;
  reuseSearchDocument: boolean;
  searchHtml?: string;
  searchDoc?: CheerioAPI;
}

export const toCrawlerErrorResult = (error: unknown): CrawlerErrorResult => {
  const siteError = findSiteError(error);
  return {
    success: false,
    error: toErrorMessage(error),
    reason: siteError?.reason ?? "unknown",
    httpStatus: siteError?.options.httpStatus,
    retryAfterMs: siteError?.options.retryAfterMs,
    candidates: siteError?.options.candidates,
    cause: error,
  };
};

export abstract class BaseCrawler implements SiteAdapter {
  protected readonly logger = runtimeLoggerService.getLogger(this.constructor.name);

  protected readonly gateway: FetchGateway;

  constructor(dependencies: AdapterDependencies) {
    this.gateway = dependencies.gateway;
  }

  abstract site(): Website;

  protected newContext(input: CrawlerInput): Context {
    return {
      number: input.number,
      site: input.site,
      options: {
        ...DEFAULT_OPTIONS,
        ...input.options,
      },
    };
  }

  protected abstract generateSearchUrl(context: Context): Promise<string | null>;

  protected abstract parseSearchPage(
    context: Context,
    $: CheerioAPI,
    searchUrl: string,
  ): Promise<string | SearchPageResolution | null>;

  protected abstract parseDetailPage(context: Context, $: CheerioAPI, detailUrl: string): Promise<CrawlerData | null>;

  /** Explains a detail page that yielded no metadata; unexplained pages count as parse errors. */
  protected classifyDetailFailure(
    _context: Context,
    _detailHtml: string,
    _$: CheerioAPI,
    _detailUrl: string,
  ): SiteError | null {
    return null;
  }

  protected reuseSearchDocument(detailUrl: string): SearchPageResolution {
    return {
      detailUrl,
      reuseSearchDocument: true,
    };
  }

  async crawl(input: CrawlerInput): Promise<CrawlerResponse> {
    const startedAt = Date.now();
    const context = this.newContext(input);

    const result = await this.runPipeline(context, input.number);

    return {
      input,
      result,
      elapsedMs: Date.now() - startedAt,
    };
  }

  private async runPipeline(context: Context, requestedNumber: string): Promise<CrawlerResult> {
    try {
      const detailRequest: DetailRequest =
        typeof context.options.detailUrl === "string" && context.options.detailUrl.trim().length > 0
          ? { detailUrl: context.options.detailUrl.trim(), reuseSearchDocument: false }
          : await this.resolveDetailRequest(context);

      const detailHtml = detailRequest.reuseSearchDocument
        ? (detailRequest.searchHtml ?? "")
        : await this.fetch(detailRequest.detailUrl, context);
      const detailDoc = detailRequest.reuseSearchDocument
        ? (detailRequest.searchDoc ?? load(detailHtml))
        : load(detailHtml);
      const data = await this.parseDetailPage(context, detailDoc, detailRequest.detailUrl);
      if (!data) {
        throw (
          this.classifyDetailFailure(context, detailHtml, detailDoc, detailRequest.detailUrl) ??
          new SiteError("parse_error", `Metadata parsing failed for ${context.number}`)
        );
      }

      verifyMovieNumber(data.number, requestedNumber);
      return {
        success: true,
        data: this.normalizeCrawlerData(context, data),
      };
    } catch (error) {
      this.logger.warn(`Crawler pipeline failed for ${context.number}: ${toErrorMessage(error)}`);
      return toCrawlerErrorResult(error);
    }
  }

  private async resolveDetailRequest(context: Context): Promise<DetailRequest> {
    const searchUrl = await this.generateSearchUrl(context);
    if (!searchUrl) {
      throw new SiteError("not_found", `Search URL not generated for ${context.number}`);
    }

    const searchHtml = await this.fetch(searchUrl, context);
    const searchDoc = load(searchHtml);
    const searchResolution = await this.parseSearchPage(context, searchDoc, searchUrl);
    if (!searchResolution) {
      throw new SiteError("not_found", `Detail URL not found for ${context.number}`);
    }

    const detailRequest =
      typeof searchResolution === "string"
        ? { detailUrl: searchResolution, reuseSearchDocument: false }
        : {
            detailUrl: searchResolution.detailUrl,
            reuseSearchDocument: searchResolution.reuseSearchDocument ?? false,
          };

    return {
      ...detailRequest,
      searchHtml,
      searchDoc,
    };
  }

  protected async fetch(url: string, context: Context): Promise<string> {
    return this.gateway.fetchHtml(url, this.createFetchOptions(context));
  }

  protected buildHeaders(context: Context): Record<string, string> {
    const headers: Record<string, string> = {};

    if (context.options.cookies) {
      headers.cookie = context.options.cookies;
    }

    if (context.options.referer) {
      headers.referer = context.options.referer;
    }

    if (context.options.userAgent) {
      headers["user-agent"] = context.options.userAgent;
    }

    return headers;
  }

  protected createFetchOptions(context: Context): FetchOptions {
    return {
      timeout: context.options.timeoutMs,
      headers: this.buildHeaders(context),
      signal: context.options.signal,
      cookies: context.options.cookies,
    };
  }

  private normalizeCrawlerData(context: Context, data: CrawlerData): CrawlerData {
    return {
      ...data,
      website: data.website ?? context.site,
      actors: data.actors ?? [],
      genres: data.genres ?? [],
      scene_images: data.scene_images ?? [],
    };
  }
}

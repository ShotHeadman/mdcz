import { runtimeLoggerService, toErrorMessage } from "@mdcz/runtime/shared";
import type { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import { type CheerioAPI, load } from "cheerio";
import type { FetchGateway, FetchOptions } from "../FetchGateway";

import type {
  AdapterDependencies,
  Context,
  CrawlerInput,
  CrawlerResponse,
  CrawlerResult,
  FailureReason,
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

const toFailureReason = (message: string): FailureReason => {
  const lowered = message.toLowerCase();

  if (lowered.includes("region blocked")) {
    return "region_blocked";
  }

  if (lowered.includes("login wall")) {
    return "login_wall";
  }

  if (
    lowered.includes("timeout") ||
    lowered.includes("timed out") ||
    lowered.includes("etimedout") ||
    lowered.includes("abort")
  ) {
    return "timeout";
  }

  if (lowered.includes("not found") || lowered.includes("detail url not found") || lowered.includes("search url")) {
    return "not_found";
  }

  if (lowered.includes("parse") || lowered.includes("metadata")) {
    return "parse_error";
  }

  return "unknown";
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

  protected classifyDetailFailure(
    _context: Context,
    _detailHtml: string,
    _$: CheerioAPI,
    _detailUrl: string,
  ): string | null {
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

    const result = await this.runPipeline(context);

    return {
      input,
      result,
      elapsedMs: Date.now() - startedAt,
    };
  }

  private async runPipeline(context: Context): Promise<CrawlerResult> {
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
        let classifiedMessage: string | null = null;
        try {
          classifiedMessage = this.classifyDetailFailure(context, detailHtml, detailDoc, detailRequest.detailUrl);
        } catch (error) {
          const message = toErrorMessage(error);
          this.logger.warn(`Detail failure classifier failed for ${context.number}: ${message}`);
        }

        return {
          success: false,
          error: classifiedMessage ?? `Metadata parsing failed for ${context.number}`,
          failureReason: classifiedMessage ? toFailureReason(classifiedMessage) : "parse_error",
        };
      }

      return {
        success: true,
        data: this.normalizeCrawlerData(context, data),
      };
    } catch (error) {
      const message = toErrorMessage(error);
      this.logger.warn(`Crawler pipeline failed for ${context.number}: ${message}`);
      return {
        success: false,
        error: message,
        failureReason: toFailureReason(message),
        cause: error,
      };
    }
  }

  private async resolveDetailRequest(context: Context): Promise<DetailRequest> {
    const searchUrl = await this.generateSearchUrl(context);
    if (!searchUrl) {
      throw new Error(`Search URL not generated for ${context.number}`);
    }

    const searchHtml = await this.fetch(searchUrl, context);
    const searchDoc = load(searchHtml);
    const searchResolution = await this.parseSearchPage(context, searchDoc, searchUrl);
    if (!searchResolution) {
      throw new Error(`Detail URL not found for ${context.number}`);
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
      number: data.number || context.number,
      website: data.website ?? context.site,
      actors: data.actors ?? [],
      genres: data.genres ?? [],
      scene_images: data.scene_images ?? [],
    };
  }
}

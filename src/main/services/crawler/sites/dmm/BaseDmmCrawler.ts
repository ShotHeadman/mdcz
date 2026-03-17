import type { CheerioAPI } from "cheerio";

import { BaseCrawler } from "../../base/BaseCrawler";
import type { Context, CrawlerInput } from "../../base/types";
import type { FetchOptions } from "../../FetchGateway";

import { classifyDmmDetailFailure } from "./failureClassifier";
import { buildDmmHttpOptions, normalizeDmmCookieHeader } from "./SessionVault";

/**
 * Shared base for DMM and DMM_TV crawlers.
 * Encapsulates cookie management, failure classification,
 * and fetch option building for DMM-family crawlers.
 */
export abstract class BaseDmmCrawler extends BaseCrawler {
  protected abstract dmmSiteLabel(): "DMM" | "DMM_TV";

  protected override newContext(input: CrawlerInput): Context {
    const context = super.newContext(input);
    context.options.cookies = normalizeDmmCookieHeader(context.options.cookies);
    return context;
  }

  protected override classifyDetailFailure(
    _context: Context,
    detailHtml: string,
    $: CheerioAPI,
    detailUrl: string,
  ): string | null {
    const titleText = $("title").first().text().trim();
    const h1Text = $("h1#title, h1").first().text().trim();
    const mergedTitle = `${titleText} ${h1Text}`.trim() || undefined;

    return classifyDmmDetailFailure({
      html: detailHtml,
      title: mergedTitle,
      detailUrl,
      siteLabel: this.dmmSiteLabel(),
    });
  }

  protected createFetchOptions(context: Context): FetchOptions {
    const headers: Record<string, string> = {};
    if (context.options.referer) {
      headers.referer = context.options.referer;
    }
    if (context.options.userAgent) {
      headers["user-agent"] = context.options.userAgent;
    }

    return buildDmmHttpOptions(context.options.cookies, {
      timeout: context.options.timeoutMs,
      signal: context.options.signal,
      headers,
    });
  }
}

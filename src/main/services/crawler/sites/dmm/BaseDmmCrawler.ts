import { toErrorMessage } from "@main/utils/common";
import type { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import type { CheerioAPI } from "cheerio";

import { BaseCrawler } from "../../base/BaseCrawler";
import type { Context, CrawlerInput } from "../../base/types";
import type { FetchOptions } from "../../FetchGateway";

import {
  buildDmmVideoGraphQlFetchOptions,
  buildDmmVideoPayload,
  DMM_VIDEO_GRAPHQL_ENDPOINT,
  getDmmVideoContentIdsFromUrl,
  parseDmmVideoData,
  toDmmVideoCrawlerData,
} from "./dmmVideo";
import { classifyDmmDetailFailure } from "./failureClassifier";
import { buildDmmHttpOptions, normalizeDmmCookieHeader } from "./SessionVault";

type DmmFamilyWebsite = Website.DMM | Website.DMM_TV;

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

  protected createDmmVideoGraphQlFetchOptions(context: Context): FetchOptions {
    return buildDmmVideoGraphQlFetchOptions(this.createFetchOptions(context));
  }

  protected async fetchDmmVideoData(
    context: Context,
    contentId: string,
    fallbackNumber: string = context.number,
  ): Promise<Partial<CrawlerData> | null> {
    const videoResponse = await this.gateway.fetchGraphQL<unknown>(
      DMM_VIDEO_GRAPHQL_ENDPOINT,
      buildDmmVideoPayload(contentId),
      this.createDmmVideoGraphQlFetchOptions(context),
    );
    return parseDmmVideoData(videoResponse, fallbackNumber);
  }

  protected async tryDmmVideoContentIds(
    context: Context,
    contentIds: Iterable<string>,
    website: DmmFamilyWebsite,
    logLabel: string,
  ): Promise<CrawlerData | null> {
    const uniqueContentIds = Array.from(new Set(Array.from(contentIds).filter((value) => value.length > 0)));

    for (const contentId of uniqueContentIds) {
      try {
        const result = toDmmVideoCrawlerData(await this.fetchDmmVideoData(context, contentId), context.number, website);
        if (result) {
          return result;
        }
      } catch (error) {
        const message = toErrorMessage(error);
        this.logger.debug(`${logLabel} miss for ${contentId}: ${message}`);
      }
    }

    return null;
  }

  protected async tryDmmVideoDetailUrl(
    context: Context,
    detailUrl: string,
    website: DmmFamilyWebsite,
    logLabel: string,
  ): Promise<CrawlerData | null> {
    return this.tryDmmVideoContentIds(context, getDmmVideoContentIdsFromUrl(detailUrl), website, logLabel);
  }
}

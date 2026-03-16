import { buildDmmAwsImageCandidates, isDmmAwsPlaceholderUrl, toDmmAwsProbeUrl } from "@main/utils/dmmImage";
import type { CrawlerData } from "@shared/types";
import type { CheerioAPI } from "cheerio";

import { BaseCrawler } from "../../base/BaseCrawler";
import type { Context, CrawlerInput } from "../../base/types";
import type { FetchOptions } from "../../FetchGateway";

import { classifyDmmDetailFailure } from "./failureClassifier";
import { buildDmmHttpOptions, normalizeDmmCookieHeader } from "./SessionVault";

/**
 * Shared base for DMM and DMM_TV crawlers.
 * Encapsulates cookie management, failure classification,
 * fetch option building, and AWS image optimization.
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

  protected async optimizeAwsImages(
    data: Partial<CrawlerData>,
    context: Context,
    rawNumber?: string,
  ): Promise<Partial<CrawlerData>> {
    const thumbUrl = data.thumb_url;
    if (!thumbUrl) {
      return data;
    }

    const awsCandidates = buildDmmAwsImageCandidates(thumbUrl, rawNumber);
    if (awsCandidates.length === 0) {
      return data;
    }

    const results = await Promise.all(
      awsCandidates.map(async (awsUrl) => {
        try {
          return (await this.isValidAwsImage(awsUrl, context)) ? awsUrl : null;
        } catch {
          return null;
        }
      }),
    );

    const validUrl = results.find((url): url is string => url !== null);
    if (validUrl) {
      this.logger.debug(`Using AWS high-quality image: ${validUrl}`);
      return {
        ...data,
        thumb_url: validUrl,
        poster_url: validUrl.replace("pl.jpg", "ps.jpg"),
      };
    }

    return data;
  }

  private async isValidAwsImage(awsUrl: string, context: Context): Promise<boolean> {
    const probe = await this.gateway.probeUrl(toDmmAwsProbeUrl(awsUrl), {
      ...this.createFetchOptions(context),
      method: "GET",
    });
    return probe.ok && !isDmmAwsPlaceholderUrl(probe.resolvedUrl);
  }
}

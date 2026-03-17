import { normalizeCode, normalizeText } from "@main/utils/normalization";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import type { CheerioAPI } from "cheerio";
import { BaseCrawler } from "../base/BaseCrawler";
import { extractText, parseDate } from "../base/parser";
import type { Context } from "../base/types";
import { toAbsoluteUrl } from "./helpers";

const JAVBUS_BASE_URL = "https://www.javbus.com";

type CheerioInput = Parameters<CheerioAPI>[0];

const isAgeVerificationPage = ($: CheerioAPI): boolean => {
  const title = $("title").first().text().trim();
  if (title.includes("Age Verification JavBus")) {
    return true;
  }

  if ($("#ageVerify").length > 0) {
    return true;
  }

  const modalTitle = $("h4.modal-title").first().text().trim();
  return modalTitle.includes("你是否已經成年");
};

const buildPosterUrl = (thumbUrl: string | undefined): string | undefined => {
  if (!thumbUrl) {
    return undefined;
  }

  if (thumbUrl.includes("/pics/")) {
    return thumbUrl.replace("/cover/", "/thumb/").replace("_b.jpg", ".jpg");
  }

  if (thumbUrl.includes("/imgs/")) {
    return thumbUrl.replace("/cover/", "/thumbs/").replace("_b.jpg", ".jpg");
  }

  return undefined;
};

export class JavbusCrawler extends BaseCrawler {
  site(): Website {
    return Website.JAVBUS;
  }

  protected override buildHeaders(context: Context): Record<string, string> {
    return {
      ...super.buildHeaders(context),
      "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6",
    };
  }

  protected async generateSearchUrl(context: Context): Promise<string | null> {
    const number = normalizeText(context.number);
    if (!number) {
      return null;
    }

    return `${JAVBUS_BASE_URL}/search/${encodeURIComponent(number)}`;
  }

  protected async parseSearchPage(context: Context, $: CheerioAPI, searchUrl: string): Promise<string | null> {
    if (isAgeVerificationPage($)) {
      throw new Error("Javbus age verification page detected; provide JAVBUS_COOKIE or use an accessible network");
    }

    const expected = normalizeCode(context.number);
    const candidates = $("a.movie-box")
      .toArray()
      .map((element: CheerioInput) => $(element).attr("href"))
      .filter((href: string | undefined): href is string => typeof href === "string" && href.length > 0);

    for (const href of candidates) {
      const normalized = normalizeCode(href.split("?")[0]?.split("#")[0] ?? href);
      if (normalized.endsWith(`/${expected}`)) {
        return toAbsoluteUrl(JAVBUS_BASE_URL, href) ?? null;
      }
    }

    const fallbackUrl = `${JAVBUS_BASE_URL}/${encodeURIComponent(context.number.toUpperCase())}`;
    this.logger.debug(`No javbus search match for ${context.number} via ${searchUrl}, fallback to ${fallbackUrl}`);
    return fallbackUrl;
  }

  protected async parseDetailPage(context: Context, $: CheerioAPI, _detailUrl: string): Promise<CrawlerData | null> {
    const titleRaw = extractText($, "h3");
    if (!titleRaw) {
      return null;
    }

    const readHeaderValue = (labels: string[]): string | undefined => {
      const headers = $("span.header")
        .toArray()
        .map((element: CheerioInput) => {
          const headerText = $(element).text().trim();
          return {
            element,
            headerText,
          };
        });

      const target = headers.find((entry) => labels.some((label) => entry.headerText.includes(label)));
      if (!target) {
        return undefined;
      }

      const parent = $(target.element).parent();
      const clone = parent.clone();
      clone.find("span.header").remove();
      const value = clone.text().replace(/\s+/gu, " ").trim();
      return value.length > 0 ? value : undefined;
    };

    const number = readHeaderValue(["識別碼", "识别码", "ID"]) ?? context.number;
    const release = parseDate(readHeaderValue(["發行日期", "发行日期", "Released"])) ?? undefined;

    const actors = $("div.star-name a")
      .map((_index: number, element: CheerioInput) => $(element).text().trim())
      .get()
      .filter((name: string) => name.length > 0);

    const genres = $("span.genre label a[href*='/genre/']")
      .map((_index: number, element: CheerioInput) => $(element).text().trim())
      .get()
      .filter((name: string) => name.length > 0);

    const thumbUrl = $("a.bigImage").first().attr("href") ?? undefined;
    const thumbUrlAbsolute = toAbsoluteUrl(JAVBUS_BASE_URL, thumbUrl);
    const posterUrl = buildPosterUrl(thumbUrlAbsolute);

    const studio = $("a[href*='/studio/']").first().text().trim() || undefined;
    const publisherText = $("a[href*='/label/']").first().text().trim();
    const publisher = publisherText.length > 0 ? publisherText : studio;
    const director = $("a[href*='/director/']").first().text().trim() || undefined;
    const series = $("a[href*='/series/']").first().text().trim() || undefined;

    const sampleImageUrls = $("#sample-waterfall a")
      .toArray()
      .map((element: CheerioInput) => $(element).attr("href"))
      .filter((href: string | undefined): href is string => typeof href === "string" && href.length > 0)
      .map((href: string) => toAbsoluteUrl(JAVBUS_BASE_URL, href))
      .filter((href): href is string => Boolean(href));

    const title = titleRaw.replace(number, "").trim();

    return {
      title,
      number,
      actors,
      genres,
      studio,
      director,
      publisher,
      series,
      plot: undefined,
      release_date: release,
      rating: undefined,
      thumb_url: thumbUrlAbsolute,
      poster_url: posterUrl,
      fanart_url: undefined,
      sample_images: sampleImageUrls,
      trailer_url: undefined,
      website: Website.JAVBUS,
    };
  }
}

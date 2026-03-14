import { normalizeCode, normalizeText } from "@main/utils/normalization";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import type { CheerioAPI } from "cheerio";
import { BaseCrawler } from "../base/BaseCrawler";
import { extractAttr, extractText, parseDate } from "../base/parser";
import type { Context } from "../base/types";
import { toAbsoluteUrl } from "./helpers";

const JAVDB_BASE_URL = "https://javdb.com";

type CheerioInput = Parameters<CheerioAPI>[0];

const findStrongRow = ($: CheerioAPI, labels: string[]): string | undefined => {
  const candidates = $("strong")
    .toArray()
    .map((element: CheerioInput) => {
      const text = $(element).text().trim();
      return { element, text };
    });

  const row = candidates.find((entry) => labels.some((label) => entry.text.includes(label)));
  if (!row) {
    return undefined;
  }

  const parent = $(row.element).parent();
  const clone = parent.clone();
  clone.find("strong").remove();
  const text = clone.text().replace(/\s+/gu, " ").trim();
  return text.length > 0 ? text : undefined;
};

const findStrongLinks = ($: CheerioAPI, labels: string[]): string[] => {
  const candidates = $("strong")
    .toArray()
    .map((element: CheerioInput) => {
      const text = $(element).text().trim();
      return { element, text };
    });

  const row = candidates.find((entry) => labels.some((label) => entry.text.includes(label)));
  if (!row) {
    return [];
  }

  const parent = $(row.element).parent();
  const links = parent
    .find("a")
    .toArray()
    .map((element: CheerioInput) => $(element).text().trim())
    .filter((value: string) => value.length > 0);

  return Array.from(new Set(links));
};

export class JavdbCrawler extends BaseCrawler {
  site(): Website {
    return Website.JAVDB;
  }

  protected async generateSearchUrl(context: Context): Promise<string | null> {
    const raw = normalizeText(context.number);
    if (!raw) {
      return null;
    }

    let number = raw;
    const oldDate = number.match(/\D+(\d{2}\.\d{2}\.\d{2})$/u);
    if (oldDate) {
      number = number.replace(oldDate[1], `20${oldDate[1]}`);
    }

    const base = this.resolveBaseUrl(context, JAVDB_BASE_URL);
    return `${base}/search?q=${encodeURIComponent(number)}&locale=zh`;
  }

  protected async parseSearchPage(context: Context, $: CheerioAPI, searchUrl: string): Promise<string | null> {
    const pageText = $.root().text();
    if (pageText.includes("ray-id")) {
      throw new Error("JavDB blocked by Cloudflare challenge");
    }

    if (pageText.includes("banned your access")) {
      throw new Error("JavDB temporarily banned current IP");
    }

    if (pageText.includes("Due to copyright restrictions")) {
      throw new Error("JavDB blocked due to region restriction");
    }

    const results = $("a.box")
      .toArray()
      .map((element: CheerioInput) => {
        const href = $(element).attr("href") ?? "";
        const title = $(element).find("div.video-title strong").text().trim();
        const meta = $(element).find("div.meta").text().trim();
        return { href, title, meta };
      })
      .filter((item) => item.href.length > 0);

    if (results.length === 0) {
      this.logger.debug(`No javdb search results for ${context.number} via ${searchUrl}`);
      return null;
    }

    const base = this.resolveBaseUrl(context, JAVDB_BASE_URL);
    const expected = context.number.toUpperCase();
    const exact = results.find((item) => item.title.toUpperCase().includes(expected));
    if (exact) {
      return toAbsoluteUrl(base, exact.href) ?? null;
    }

    const cleanExpected = normalizeCode(context.number);
    const fuzzy = results.find((item) => normalizeCode(item.title + item.meta).includes(cleanExpected));
    if (fuzzy) {
      return toAbsoluteUrl(base, fuzzy.href) ?? null;
    }

    return null;
  }

  protected async parseDetailPage(context: Context, $: CheerioAPI, _detailUrl: string): Promise<CrawlerData | null> {
    const title = extractText($, "h2.title.is-4 strong.current-title");
    if (!title) {
      return null;
    }

    const number =
      extractAttr($, "a.button.is-white.copy-to-clipboard", "data-clipboard-text")?.trim() || context.number;

    const actorsPrimary = $("strong.female")
      .toArray()
      .flatMap((element: CheerioInput) => $(element).parent().find("a").toArray())
      .map((element: CheerioInput) => $(element).text().trim())
      .filter((name: string) => name.length > 0);

    const actorsFallback = $("strong.male")
      .toArray()
      .flatMap((element: CheerioInput) => $(element).parent().find("a").toArray())
      .map((element: CheerioInput) => $(element).text().trim())
      .filter((name: string) => name.length > 0);

    const actors = actorsPrimary.length > 0 ? actorsPrimary : actorsFallback;

    const genres = findStrongLinks($, ["類別:", "Tags:", "类别:"]);

    const studio = findStrongRow($, ["片商:", "Maker:"])?.trim() || undefined;
    const publisher = findStrongRow($, ["發行:", "Publisher:"])?.trim() || undefined;
    const series = findStrongRow($, ["系列:", "Series:"])?.trim() || undefined;
    const director = findStrongRow($, ["導演:", "Director:"])?.trim() || undefined;
    const release = parseDate(findStrongRow($, ["日期:", "Released Date:"])) ?? undefined;

    const thumbUrl = extractAttr($, "img.video-cover", "src");
    const thumbUrlAbsolute = toAbsoluteUrl(JAVDB_BASE_URL, thumbUrl);
    const posterUrl = thumbUrlAbsolute?.replace("/covers/", "/thumbs/");

    const trailerUrl = extractAttr($, "video#preview-video source", "src") ?? undefined;
    const trailerUrlAbsolute = toAbsoluteUrl(JAVDB_BASE_URL, trailerUrl);

    const sampleImageUrls = $("div.tile-images.preview-images a.tile-item")
      .toArray()
      .map((element: CheerioInput) => $(element).attr("href"))
      .filter((href: string | undefined): href is string => typeof href === "string" && href.length > 0)
      .map((href: string) => toAbsoluteUrl(JAVDB_BASE_URL, href))
      .filter((href): href is string => Boolean(href));

    const ratingText = findStrongRow($, ["評分:", "Rating:"]);
    let ratingValue: number | undefined;
    if (ratingText) {
      const match = ratingText.match(/([\d.]+)/u);
      if (match) {
        const parsed = Number.parseFloat(match[1]);
        if (Number.isFinite(parsed)) {
          ratingValue = parsed;
        }
      }
    }

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
      rating: ratingValue,
      thumb_url: thumbUrlAbsolute,
      poster_url: posterUrl,
      fanart_url: undefined,
      sample_images: sampleImageUrls,
      trailer_url: trailerUrlAbsolute,
      website: Website.JAVDB,
    };
  }
}

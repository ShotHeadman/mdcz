import { SiteError, type SiteRequestConfig } from "@mdcz/runtime/network";
import { normalizeText, uniqueStrings } from "@mdcz/runtime/shared";
import { OFFICIAL_SITE_URLS } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import type { CheerioAPI } from "cheerio";
import type { ContentType } from "../../scrape/utils/movieClassification";
import { BaseCrawler } from "../base/BaseCrawler";
import { movieNumbersMatch, toDateSequenceLabel } from "../base/identity";
import { extractAttr, extractText, parseDate } from "../base/parser";
import type { Context } from "../base/types";
import type { CrawlerRegistration } from "../registration";
import { extractParentLinksByLabelSelector, extractParentTextByLabelSelector, toAbsoluteUrl } from "./helpers";

type CheerioInput = Parameters<CheerioAPI>[0];

// JavDB answers mirrors too, so its block pages are recognized by crawler rather than by host.
const JAVDB_SITE_REQUEST_CONFIGS: readonly SiteRequestConfig[] = [
  {
    id: "crawler:javdb",
    matches: (_url, site) => site === Website.JAVDB,
    classifyBlockedPage: (body) => {
      if (body.includes("Due to copyright restrictions")) return "region_blocked";
      if (body.includes("banned your access")) return "ip_banned";
      return null;
    },
  },
];

export class JavdbCrawler extends BaseCrawler {
  static readonly contentTypes: readonly ContentType[] = ["censored", "uncensored", "fc2"];
  static readonly siteRequestConfigs = JAVDB_SITE_REQUEST_CONFIGS;

  site(): Website {
    return Website.JAVDB;
  }

  // JavDB localizes pages by Accept-Language; the label parser and genre mapping expect its Chinese pages.
  protected override buildHeaders(context: Context): Record<string, string> {
    return { "accept-language": "zh-TW,zh;q=0.9", ...super.buildHeaders(context) };
  }

  protected async generateSearchUrl(context: Context): Promise<string | null> {
    const raw = normalizeText(context.number);
    if (!raw) {
      return null;
    }

    let number = toDateSequenceLabel(raw) ?? raw;
    const oldDate = number.match(/\D+(\d{2}\.\d{2}\.\d{2})$/u);
    if (oldDate) {
      number = number.replace(oldDate[1], `20${oldDate[1]}`);
    }

    return `${context.options.baseUrl ?? OFFICIAL_SITE_URLS[Website.JAVDB]}/search?q=${encodeURIComponent(number)}`;
  }

  protected async parseSearchPage(context: Context, $: CheerioAPI, searchUrl: string): Promise<string | null> {
    // Search results include similar numbers, such as another studio's title from the same day.
    const matches = new Map<string, CheerioInput>();
    for (const element of $("a.box").toArray()) {
      if (!movieNumbersMatch($(element).find("div.video-title strong").text(), context.number)) continue;
      const url = toAbsoluteUrl(searchUrl, $(element).attr("href"));
      if (url && !matches.has(url)) matches.set(url, element);
    }
    // Two works under one number are different movies (SW-133 is a 2012 SWITCH and a 2022 Plum title).
    if (matches.size > 1) {
      throw new SiteError("ambiguous", `JavDB lists ${matches.size} works under ${context.number}`, {
        candidates: [...matches].map(([detailUrl, element]) => {
          const title = $(element).find("div.video-title").clone();
          title.find("strong").remove();
          const meta = normalizeText($(element).find("div.meta").text());
          const usDate = meta.match(/^(\d{2})\/(\d{2})\/(\d{4})$/u);
          return {
            site: Website.JAVDB,
            detailUrl,
            title: normalizeText(title.text()) || context.number,
            releaseDate: usDate ? `${usDate[3]}-${usDate[1]}-${usDate[2]}` : parseDate(meta),
            coverUrl: toAbsoluteUrl(searchUrl, $(element).find("div.cover img").attr("src")),
          };
        }),
      });
    }
    return matches.keys().next().value ?? null;
  }

  // JavDB redirects FC2 and uncensored titles to its sign-in page unless the cookie belongs to a signed-in account.
  protected override classifyDetailFailure(_context: Context, detailHtml: string): SiteError | null {
    return detailHtml.includes('action="/user_sessions"')
      ? new SiteError("login_wall", "JavDB requires a signed-in cookie for this title")
      : null;
  }

  protected async parseDetailPage(_context: Context, $: CheerioAPI, detailUrl: string): Promise<CrawlerData | null> {
    const title = extractText($, "h2.title.is-4 strong.current-title");
    if (!title) {
      return null;
    }

    const number = extractAttr($, "a.button.is-white.copy-to-clipboard", "data-clipboard-text")?.trim() ?? "";

    // JavDB marks only actresses; unmarked links in the actor row are male performers.
    const actresses = uniqueStrings(
      $("a.actor-female")
        .toArray()
        .map((element: CheerioInput) => normalizeText($(element).text())),
    );
    const actors = actresses.length > 0 ? actresses : extractParentLinksByLabelSelector($, "strong", ["演員:"]);

    const genres = extractParentLinksByLabelSelector($, "strong", ["類別:"]);

    const studio = extractParentTextByLabelSelector($, "strong", ["片商:"]);
    const publisher = extractParentTextByLabelSelector($, "strong", ["發行:"]);
    const series = extractParentTextByLabelSelector($, "strong", ["系列:"]);
    const director = extractParentTextByLabelSelector($, "strong", ["導演:"]);
    const release = parseDate(extractParentTextByLabelSelector($, "strong", ["日期:"])) ?? undefined;

    const thumbUrl = extractAttr($, "img.video-cover", "src");
    const thumbUrlAbsolute = toAbsoluteUrl(detailUrl, thumbUrl);
    const posterUrl = thumbUrlAbsolute?.replace("/covers/", "/thumbs/");

    const trailerUrl = extractAttr($, "video#preview-video source", "src") ?? undefined;
    const trailerUrlAbsolute = toAbsoluteUrl(detailUrl, trailerUrl);

    const sceneImageUrls = $("div.tile-images.preview-images a.tile-item")
      .toArray()
      .map((element: CheerioInput) => $(element).attr("href"))
      .filter((href: string | undefined): href is string => typeof href === "string" && href.length > 0)
      .map((href: string) => toAbsoluteUrl(detailUrl, href))
      .filter((href): href is string => Boolean(href));

    const ratingText = extractParentTextByLabelSelector($, "strong", ["評分:"]);
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
      scene_images: sceneImageUrls,
      trailer_url: trailerUrlAbsolute,
      website: Website.JAVDB,
    };
  }
}

export const crawlerRegistration: CrawlerRegistration = {
  site: Website.JAVDB,
  crawler: JavdbCrawler,
};

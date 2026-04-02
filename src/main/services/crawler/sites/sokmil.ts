import { normalizeText } from "@main/utils/normalization";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import type { CheerioAPI } from "cheerio";
import { BaseCrawler } from "../base/BaseCrawler";
import { parseDate } from "../base/parser";
import type { Context, SearchPageResolution } from "../base/types";
import { toAbsoluteUrl, uniqueStrings } from "./helpers";

const SOKMIL_BASE_URL = "https://www.sokmil.com";

/**
 * sectionid=1 → AV, sectionid=2 → idol/gravure.
 * Default to idol section since sokmil is mainly used for gravure content
 * via idolerotic.net links. AV section requires age-auth cookies.
 */
const DEFAULT_SECTION_ID = "2";

type CheerioInput = Parameters<CheerioAPI>[0];

const normalizeSokmilSearchText = (value: string | undefined | null): string =>
  normalizeText(value).replace(/\s+/gu, "");

const extractDtDdValue = ($: CheerioAPI, label: string): string | undefined => {
  const dt = $("dt")
    .filter((_i: number, el: CheerioInput) => $(el).text().trim() === label)
    .first();
  if (dt.length === 0) {
    return undefined;
  }
  const value = dt.next("dd").text().trim();
  return value || undefined;
};

export class SokmilCrawler extends BaseCrawler {
  site(): Website {
    return Website.SOKMIL;
  }

  protected override buildHeaders(context: Context): Record<string, string> {
    const headers = super.buildHeaders(context);
    // Ensure age-auth cookie is always present for AV section access
    const existing = headers.cookie ?? "";
    if (!existing.includes("AGEAUTH=")) {
      headers.cookie = existing ? `${existing}; AGEAUTH=ok` : "AGEAUTH=ok";
    }
    return headers;
  }

  protected async generateSearchUrl(context: Context): Promise<string | null> {
    const number = normalizeText(context.number);
    if (!number) {
      return null;
    }

    const base = this.resolveBaseUrl(context, SOKMIL_BASE_URL);
    return `${base}/search/keyword/?sectionid=${DEFAULT_SECTION_ID}&q=${encodeURIComponent(number)}`;
  }

  protected async parseSearchPage(
    context: Context,
    $: CheerioAPI,
    _searchUrl: string,
  ): Promise<string | SearchPageResolution | null> {
    const base = this.resolveBaseUrl(context, SOKMIL_BASE_URL);
    const searchText = normalizeSokmilSearchText(context.number);
    if (!searchText) {
      return null;
    }

    const match = $("div.product[data-pid]")
      .toArray()
      .map((element: CheerioInput) => {
        const root = $(element);
        return {
          href: root.find("a[href*='_item/item']").first().attr("href"),
          title: root.find(".title").first().text().trim(),
        };
      })
      .find((item) => normalizeSokmilSearchText(item.title) === searchText);

    if (!match?.href) {
      return null;
    }

    return toAbsoluteUrl(base, match.href.split("?")[0]) ?? null;
  }

  protected async parseDetailPage(context: Context, $: CheerioAPI, _detailUrl: string): Promise<CrawlerData | null> {
    const h1 = $("h1").first().text().trim();
    if (!h1) {
      return null;
    }

    const title = h1;
    const release = parseDate(extractDtDdValue($, "発売日")?.replace(/\//gu, "-")) ?? undefined;
    const studio = extractDtDdValue($, "メーカー");
    const publisher = extractDtDdValue($, "レーベル");
    const director = extractDtDdValue($, "監督");
    const series = extractDtDdValue($, "シリーズ");

    // Actors from the "出演" field
    const actorDd = $("dt")
      .filter((_i: number, el: CheerioInput) => $(el).text().trim() === "出演")
      .first()
      .next("dd");
    const actorLinks = actorDd
      .find("a")
      .map((_i: number, el: CheerioInput) => $(el).text().trim())
      .get()
      .filter((name: string) => name.length > 0);
    const actorText = actorDd.text().trim();
    const actors =
      actorLinks.length > 0 ? uniqueStrings(actorLinks) : actorText ? uniqueStrings(actorText.split(/[,、]/u)) : [];

    // Genres from the "ジャンル" field
    const genreDd = $("dt")
      .filter((_i: number, el: CheerioInput) => $(el).text().trim() === "ジャンル")
      .first()
      .next("dd");
    const genres = genreDd
      .find("a")
      .map((_i: number, el: CheerioInput) => $(el).text().trim())
      .get()
      .filter((name: string) => name.length > 0);

    // Cover image
    const jacketImg = $("img.jacket-img").first().attr("src") ?? undefined;

    return {
      title,
      number: context.number,
      actors,
      genres,
      studio,
      director,
      publisher,
      series,
      plot: undefined,
      release_date: release,
      rating: undefined,
      thumb_url: jacketImg,
      poster_url: undefined,
      fanart_url: undefined,
      scene_images: [],
      trailer_url: undefined,
      website: Website.SOKMIL,
    };
  }
}

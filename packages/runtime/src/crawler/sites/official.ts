import { Website } from "@mdcz/shared/enums";
import { OFFICIAL_MAKERS } from "@mdcz/shared/officialSites";
import type { CrawlerData } from "@mdcz/shared/types";
import type { CheerioAPI } from "cheerio";
import { BaseCrawler } from "../base/BaseCrawler";
import { parseDate } from "../base/parser";
import type { Context, SearchPageResolution } from "../base/types";
import type { CrawlerRegistration } from "../registration";
import { toAbsoluteUrl } from "./helpers";

const MAKER_BY_PREFIX = new Map(
  OFFICIAL_MAKERS.flatMap((maker) => maker.prefixes.split(" ").map((prefix) => [prefix, maker] as const)),
);

export class OfficialCrawler extends BaseCrawler {
  static readonly numberPattern = new RegExp(`^(?:${[...MAKER_BY_PREFIX.keys()].join("|")})[-_]?\\d+$`, "iu");
  site(): Website {
    return Website.OFFICIAL;
  }

  protected async generateSearchUrl(context: Context): Promise<string | null> {
    const match = context.number.trim().match(/^([a-z]+)[-_]?(\d+)$/iu);
    const maker = match ? MAKER_BY_PREFIX.get(match[1].toLowerCase()) : undefined;
    if (!maker || !match) return null;
    return `https://${maker.domain}/works/detail/${match[1].toLowerCase()}${match[2]}`;
  }

  protected async parseSearchPage(_context: Context, _$: CheerioAPI, searchUrl: string): Promise<SearchPageResolution> {
    return this.reuseSearchDocument(searchUrl);
  }

  protected async parseDetailPage(_context: Context, $: CheerioAPI, detailUrl: string): Promise<CrawlerData | null> {
    const info = new Map(
      $(".p-workPage__table div.th")
        .toArray()
        .map((element) => [$(element).text().trim(), $(element).next()]),
    );
    const numberCell = info.get("品番")?.clone();
    numberCell?.find("span").remove();
    const number =
      numberCell
        ?.text()
        .match(/[A-Z]+[-_]?\d+/iu)?.[0]
        ?.replace(/^([A-Z]+)(\d+)$/iu, "$1-$2") ?? "";
    const title = $("h2.p-workPage__title").text().trim() || $("title").text().split(" | ")[0]?.trim();
    if (!title) return null;
    const actors =
      info
        .get("女優")
        ?.find("a[href*='/actress/detail/']")
        .toArray()
        .map((element) => $(element).text().trim()) ?? [];
    const genres =
      info
        .get("ジャンル")
        ?.find("a[href*='/works/list/genre/']")
        .toArray()
        .map((element) => $(element).text().trim()) ?? [];
    const minutes = Number.parseInt(info.get("収録時間")?.text().match(/\d+/u)?.[0] ?? "", 10);
    const image = $(".p-slider img").first();
    return {
      number,
      title,
      actors: [...new Set(actors)],
      genres,
      // Manual detail URLs may name the maker's host with or without "www.".
      studio: OFFICIAL_MAKERS.find(
        (maker) => maker.domain.replace(/^www\./u, "") === new URL(detailUrl).hostname.replace(/^www\./u, ""),
      )?.studio,
      release_date: parseDate(info.get("発売日")?.text()),
      durationSeconds: Number.isFinite(minutes) ? minutes * 60 : undefined,
      director: info.get("監督")?.text().trim() || undefined,
      plot: $(".p-workPage__text").first().text().trim() || undefined,
      series: info.get("シリーズ")?.text().trim() || undefined,
      thumb_url: toAbsoluteUrl(detailUrl, image.attr("data-src") ?? image.attr("src")),
      scene_images: [],
      website: Website.OFFICIAL,
    };
  }
}

export const crawlerRegistration: CrawlerRegistration = { site: Website.OFFICIAL, crawler: OfficialCrawler };

import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import type { CheerioAPI } from "cheerio";

import { parseDate } from "../base/parser";
import type { Context, SearchPageResolution } from "../base/types";
import { BaseFc2Crawler } from "./BaseFc2Crawler";
import { toAbsoluteUrl } from "./helpers";

const BASE_URL = "https://adult.contents.fc2.com";

export class Fc2Crawler extends BaseFc2Crawler {
  site(): Website {
    return Website.FC2;
  }

  protected async generateSearchUrl(context: Context): Promise<string | null> {
    return `${BASE_URL}/article/${context.number}/`;
  }

  protected async parseSearchPage(
    _context: Context,
    $: CheerioAPI,
    searchUrl: string,
  ): Promise<string | SearchPageResolution | null> {
    const title = $("div[data-section='userInfo'] h3").first().text();
    if (!title.includes("お探しの商品が見つかりません")) {
      return this.reuseSearchDocument(searchUrl);
    }
    return null;
  }

  protected async parseDetailPage(context: Context, $: CheerioAPI): Promise<CrawlerData | null> {
    const title = $("div[data-section='userInfo'] h3").first().text().trim();
    if (!title) {
      return null;
    }

    const thumb = $("ul.items_article_SampleImagesArea li a").first().attr("href");
    const thumbUrl = toAbsoluteUrl(BASE_URL, thumb);
    const posterUrl = toAbsoluteUrl(BASE_URL, $("div.items_article_MainitemThumb img").first().attr("src"));
    const genres = $("p.card-text a[href*='/tag/']")
      .toArray()
      .map((element) => $(element).text().trim())
      .filter((value) => value.length > 0 && value !== "無修正");

    const studio = $("div.col-8").first().text().trim() || undefined;

    return this.buildFc2Data(context, {
      title,
      studio,
      genres,
      thumbUrl,
      posterUrl,
      plot: $("meta[name='description']").attr("content")?.trim(),
      releaseDate: parseDate($("div.items_article_Releasedate p").first().text()) ?? undefined,
      sceneImageUrls: $("ul.items_article_SampleImagesArea li a")
        .toArray()
        .map((element) => toAbsoluteUrl(BASE_URL, $(element).attr("href")))
        .filter((value): value is string => Boolean(value)),
    });
  }
}

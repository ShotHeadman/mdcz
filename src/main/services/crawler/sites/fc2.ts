import { isJapanese } from "@main/utils/language";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import type { CheerioAPI } from "cheerio";

import { parseDate } from "../base/parser";
import type { Context, SearchPageResolution } from "../base/types";
import { BaseFc2Crawler } from "./BaseFc2Crawler";
import { toAbsoluteUrl } from "./helpers";

const CJK_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/u;
const FC2_WATERMARK_PATTERNS = [/\s*\*{2,}[a-z]+(?:\*+[a-z]+)+\*{0,}\s*/g, /\s*-[a-z]+(?:-[a-z]+)+\s*/g];
const LATIN_OR_DIGIT_PATTERN = /[A-Za-z0-9]/u;

const BASE_URL = "https://adult.contents.fc2.com";

const findPreviousNonSpaceChar = (value: string, index: number): string | undefined => {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const char = value[cursor];
    if (!/\s/u.test(char)) {
      return char;
    }
  }

  return undefined;
};

const findNextNonSpaceChar = (value: string, index: number): string | undefined => {
  for (let cursor = index; cursor < value.length; cursor += 1) {
    const char = value[cursor];
    if (!/\s/u.test(char)) {
      return char;
    }
  }

  return undefined;
};

const shouldStripFc2Watermark = (title: string, start: number, end: number): boolean => {
  const previousChar = findPreviousNonSpaceChar(title, start);
  const nextChar = findNextNonSpaceChar(title, end);
  return !(
    (previousChar && LATIN_OR_DIGIT_PATTERN.test(previousChar)) ||
    (nextChar && LATIN_OR_DIGIT_PATTERN.test(nextChar))
  );
};

const replaceFc2Watermark = (title: string, pattern: RegExp): string => {
  let result = "";
  let lastIndex = 0;

  for (const match of title.matchAll(pattern)) {
    const matched = match[0];
    const start = match.index ?? 0;
    const end = start + matched.length;
    result += title.slice(lastIndex, start);

    if (shouldStripFc2Watermark(title, start, end)) {
      result += /^\s/u.test(matched) && /\s$/u.test(matched) ? " " : "";
    } else {
      result += matched;
    }

    lastIndex = end;
  }

  result += title.slice(lastIndex);
  return result;
};

const stripFc2Watermark = (title: string): string => {
  let current = title;
  for (const pattern of FC2_WATERMARK_PATTERNS) {
    current = replaceFc2Watermark(current, pattern);
  }

  return current.trim();
};

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
    const rawTitle = $("div[data-section='userInfo'] h3").first().text().trim();
    const title = stripFc2Watermark(rawTitle);
    if (!title || (!isJapanese(title) && !CJK_PATTERN.test(title))) {
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

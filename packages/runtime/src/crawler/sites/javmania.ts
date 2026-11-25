import { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import type { CheerioAPI } from "cheerio";
import { BaseCrawler } from "../base/BaseCrawler";
import { parseDate } from "../base/parser";
import type { Context, SearchPageResolution } from "../base/types";
import type { CrawlerRegistration } from "../registration";
import { pageIdentityUrl, toAbsoluteUrl } from "./helpers";
import { parseIsoDurationToSeconds, readFirstJsonLdRecord, readJsonLdActors } from "./jsonLd";

const BASE_URL = "https://www.jav-mania.net";

// Uncensored studios without an official crawler; JAV Mania keeps one page per release at /movies/<slug>/<id>/.
const STUDIOS: Array<{ pattern: RegExp; slug: string; studio: string }> = [
  { pattern: /^PACO-(\d{6}_\d{3})$/u, slug: "pacopacomama", studio: "パコパコママ" },
  { pattern: /^CARIBPR-(\d{6}_\d{3})$/u, slug: "caribbeanpremium", studio: "カリビアンコムプレミアム" },
  { pattern: /^MURA-(\d{6}_\d{3,4})$/u, slug: "muramura", studio: "ムラムラ" },
  { pattern: /^KIN8(?:TENGOKU)?-?(\d{3,4})$/u, slug: "kin8", studio: "金8天国" },
  { pattern: /^NYOSHIN-((?:N|LES)\d{3,4})$/u, slug: "nyoshin", studio: "女体のしんぴ" },
  { pattern: /^HGMO-(\d{4})$/u, slug: "hgmo", studio: "Hey動画" },
  { pattern: /^C0930-([A-Z]{2,8}\d{3,6})$/u, slug: "c0930", studio: "C0930" },
  { pattern: /^PIKKUR-(\d{5})$/u, slug: "pikkur", studio: "pikkur" },
  { pattern: /^AV9898-(\d{2,4})$/u, slug: "av9898", studio: "AV9898" },
];

const releasePath = (number: string): { path: string; studio: string } | undefined => {
  const normalized = number.normalize("NFKC").toUpperCase().trim();
  for (const { pattern, slug, studio } of STUDIOS) {
    const id = normalized.match(pattern)?.[1];
    if (id) return { path: `/movies/${slug}/${id.toLowerCase()}/`, studio };
  }
  return undefined;
};

// Same release whatever the language prefix (/ja/movies/…) or trailing slash; only JAV Mania's own hosts count.
const releaseUrlPath = (url: string): string | undefined => {
  const parsed = new URL(url);
  if (!["www.jav-mania.net", "jav-mania.net"].includes(parsed.hostname)) return undefined;
  return `${parsed.pathname
    .toLowerCase()
    .replace(/^\/[a-z]{2}(?=\/movies\/)/u, "")
    .replace(/\/?$/u, "")}/`;
};

const stringList = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === "string" && !!item.trim());

export class JavManiaCrawler extends BaseCrawler {
  static readonly numberPattern =
    /^(?:PACO-\d{6}_\d{3}|CARIBPR-\d{6}_\d{3}|MURA-\d{6}_\d{3,4}|KIN8(?:TENGOKU)?-?\d{3,4}|NYOSHIN-(?:N|LES)\d{3,4}|HGMO-\d{4}|C0930-[A-Z]{2,8}\d{3,6}|PIKKUR-\d{5}|AV9898-\d{2,4})$/iu;
  site(): Website {
    return Website.JAVMANIA;
  }

  protected async generateSearchUrl(context: Context): Promise<string | null> {
    const release = releasePath(context.number);
    return release ? `${BASE_URL}${release.path}` : null;
  }

  protected async parseSearchPage(_context: Context, _$: CheerioAPI, searchUrl: string): Promise<SearchPageResolution> {
    return this.reuseSearchDocument(searchUrl);
  }

  protected async parseDetailPage(context: Context, $: CheerioAPI, detailUrl: string): Promise<CrawlerData | null> {
    const release = releasePath(context.number);
    const video = readFirstJsonLdRecord($);
    // The canonical URL and the VideoObject URL name the release the page belongs to; anything else (redirect,
    // landing page, another release) is a miss.
    const canonical = toAbsoluteUrl(detailUrl, pageIdentityUrl($));
    if (!release || video?.["@type"] !== "VideoObject" || typeof video.name !== "string" || !canonical) return null;
    const identities = [canonical, typeof video.url === "string" ? toAbsoluteUrl(detailUrl, video.url) : canonical];
    if (identities.some((url) => !url || releaseUrlPath(url) !== release.path)) return null;

    // Performer names: the Japanese name follows each English one in a <span lang="ja">【…】</span>.
    const performerCell = $("table.detail-table tr")
      .filter((_, row) => /^Performers?$/u.test($(row).find("th").first().text().trim()))
      .first()
      .find("td");
    const japaneseNames = performerCell
      .find("span[lang='ja']")
      .toArray()
      .map((span) =>
        $(span)
          .text()
          .replace(/[【】]/gu, "")
          .trim(),
      )
      .filter(Boolean);
    const thumb = toAbsoluteUrl(detailUrl, stringList(video.thumbnailUrl)[0]);

    return {
      number: context.number.normalize("NFKC").toUpperCase().trim(),
      title: video.name.replace(/\s*\([^()]*\)$/u, "").trim() || video.name,
      actors: japaneseNames.length > 0 ? japaneseNames : readJsonLdActors(video.actor),
      genres: stringList(video.genre),
      studio: release.studio,
      publisher: release.studio,
      plot: typeof video.description === "string" ? video.description : undefined,
      release_date: parseDate(typeof video.uploadDate === "string" ? video.uploadDate : undefined),
      durationSeconds: parseIsoDurationToSeconds(video.duration),
      thumb_url: thumb,
      poster_url: thumb,
      scene_images: $(".gallery img")
        .toArray()
        .map((img) => toAbsoluteUrl(detailUrl, $(img).attr("src")))
        .filter((url): url is string => !!url && url !== thumb),
      trailer_url: typeof video.contentUrl === "string" ? video.contentUrl : undefined,
      website: Website.JAVMANIA,
    };
  }
}

export const crawlerRegistration: CrawlerRegistration = { site: Website.JAVMANIA, crawler: JavManiaCrawler };

import { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import type { CheerioAPI } from "cheerio";

import { BaseCrawler } from "../base/BaseCrawler";
import { movieNumbersMatch } from "../base/identity";
import type { Context } from "../base/types";
import type { CrawlerRegistration } from "../registration";

interface PrestigeSearchResponse {
  hits?: {
    hits?: Array<{
      _source?: {
        deliveryItemId?: string;
        productUuid?: string;
      };
    }>;
  };
}

interface PrestigeProductResponse {
  mgsLink?: string;
  body?: string;
  directors?: Array<{ name?: string }>;
  genre?: Array<{ name?: string }>;
  label?: { name?: string };
  maker?: { name?: string };
  media?: Array<{ path?: string }>;
  movie?: { path?: string };
  packageImage?: { path?: string };
  series?: { name?: string };
  sku?: Array<{ salesStartAt?: string; deliveryItemId?: string }>;
  thumbnail?: { path?: string };
  title?: string;
  playTime?: number;
  actress?: Array<{ name?: string }>;
}

const BASE_URL = "https://www.prestige-av.com";

export class PrestigeCrawler extends BaseCrawler {
  static readonly numberPattern =
    /^(?:ABF|ABP|ABW|ABS|CHN|ENF|ESK|MBM|MGT|PPT|RDT|TEM|TKT|YRH|FIV|SGA|KBI|NTR|NDY|SIRO|LUXU|GANA|ARA|MAAN|MIUM|SPAY|NAMA|\d{3}[A-Z]+)[-_]?\d+$/iu;
  site(): Website {
    return Website.PRESTIGE;
  }

  protected async generateSearchUrl(context: Context): Promise<string | null> {
    return `${BASE_URL}/api/search?isEnabledQuery=true&searchText=${encodeURIComponent(context.number)}&isEnableAggregation=false&release=false&reservation=false&soldOut=false&from=0&aggregationTermsSize=0&size=20`;
  }

  protected override async fetch(url: string, context: Context): Promise<string> {
    context.payload = await this.gateway.fetchJson(url, this.createFetchOptions(context));
    return "";
  }

  protected async parseSearchPage(context: Context, _$: CheerioAPI, _searchUrl: string): Promise<string | null> {
    const payload = context.payload as PrestigeSearchResponse;
    const found = (payload.hits?.hits ?? []).find((item) =>
      movieNumbersMatch(item._source?.deliveryItemId ?? "", context.number),
    );
    const uuid = found?._source?.productUuid;
    return uuid ? `${BASE_URL}/api/product/${uuid}` : null;
  }

  protected async parseDetailPage(context: Context, _$: CheerioAPI, _detailUrl: string): Promise<CrawlerData | null> {
    const data = context.payload as PrestigeProductResponse;
    const title = data.title?.replace("【配信専用】", "").trim();
    if (!title) {
      return null;
    }

    const actors = (data.actress ?? []).map((item) => item.name).filter((value): value is string => Boolean(value));
    const genres = (data.genre ?? []).map((item) => item.name).filter((value): value is string => Boolean(value));

    const toMedia = (path: string | undefined): string | undefined => {
      return path ? `${BASE_URL}/api/media/${path}` : undefined;
    };

    return {
      title,
      number:
        data.mgsLink?.match(/\/product_detail\/([^/]+)/u)?.[1] ??
        data.sku?.find((sku) => movieNumbersMatch(sku.deliveryItemId ?? "", context.number))?.deliveryItemId ??
        "",
      actors,
      genres,
      studio: data.maker?.name,
      director: data.directors?.[0]?.name,
      publisher: data.label?.name ?? data.maker?.name,
      series: data.series?.name,
      plot: data.body,
      release_date: data.sku?.[0]?.salesStartAt?.slice(0, 10),
      rating: undefined,
      thumb_url: toMedia(data.packageImage?.path),
      poster_url: toMedia(data.thumbnail?.path),
      fanart_url: undefined,
      scene_images: (data.media ?? [])
        .map((item) => toMedia(item.path))
        .filter((value): value is string => Boolean(value)),
      trailer_url: toMedia(data.movie?.path),
      website: Website.PRESTIGE,
    };
  }
}

export const crawlerRegistration: CrawlerRegistration = {
  site: Website.PRESTIGE,
  crawler: PrestigeCrawler,
};

import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import type { CheerioAPI } from "cheerio";

import { BaseCrawler } from "../base/BaseCrawler";
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
  body?: string;
  directors?: Array<{ name?: string }>;
  genre?: Array<{ name?: string }>;
  label?: { name?: string };
  maker?: { name?: string };
  media?: Array<{ path?: string }>;
  movie?: { path?: string };
  packageImage?: { path?: string };
  series?: { name?: string };
  sku?: Array<{ salesStartAt?: string }>;
  thumbnail?: { path?: string };
  title?: string;
  playTime?: number;
  actress?: Array<{ name?: string }>;
}

const BASE_URL = "https://www.prestige-av.com";

export class PrestigeCrawler extends BaseCrawler {
  site(): Website {
    return Website.PRESTIGE;
  }

  protected async generateSearchUrl(context: Context): Promise<string | null> {
    return `${BASE_URL}/api/search?isEnabledQuery=true&searchText=${encodeURIComponent(context.number)}&isEnableAggregation=false&release=false&reservation=false&soldOut=false&from=0&aggregationTermsSize=0&size=20`;
  }

  protected async parseSearchPage(context: Context, _$: CheerioAPI, searchUrl: string): Promise<string | null> {
    const payload = await this.gateway.fetchJson<PrestigeSearchResponse>(searchUrl, this.createFetchOptions(context));
    const found = (payload.hits?.hits ?? []).find((item) =>
      item._source?.deliveryItemId?.endsWith(context.number.toUpperCase()),
    );
    const uuid = found?._source?.productUuid;
    return uuid ? `${BASE_URL}/api/product/${uuid}` : null;
  }

  protected async parseDetailPage(context: Context, _$: CheerioAPI, detailUrl: string): Promise<CrawlerData | null> {
    const data = await this.gateway.fetchJson<PrestigeProductResponse>(detailUrl, this.createFetchOptions(context));
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
      number: context.number,
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

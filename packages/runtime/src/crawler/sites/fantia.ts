import type { SiteRequestConfig } from "@mdcz/runtime/network";
import { normalizeCode } from "@mdcz/runtime/shared/utils";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import type { CheerioAPI } from "cheerio";
import { load } from "cheerio";
import { BaseCrawler } from "../base/BaseCrawler";
import { parseDate } from "../base/parser";
import type { Context, SearchPageResolution } from "../base/types";
import type { CrawlerRegistration } from "../registration";
import { toAbsoluteUrl } from "./helpers";

const FANTIA_BASE_URL = "https://fantia.jp";
const FANTIA_SITE_REQUEST_CONFIGS: readonly SiteRequestConfig[] = [
  {
    id: "crawler:fantia",
    matches: (url) => url.hostname === "fantia.jp" || url.hostname.endsWith(".fantia.jp"),
    headers: {
      referer: `${FANTIA_BASE_URL}/`,
      "accept-language": "zh-CN,zh;q=0.9",
    },
  },
];

interface FantiaPostApiResponse {
  post: {
    comment?: string;
    blog_comment?: string;
    post_contents?: Array<{
      visible_status?: string;
      post_content_photos?: Array<{
        url?:
          | string
          | {
              thumb?: string;
              medium?: string;
              large?: string;
              main?: string;
              original?: string;
            };
      }>;
    }>;
  };
}

interface FantiaPostApiData {
  plot?: string;
  images: string[];
}

const isAgeVerificationPage = ($: CheerioAPI): boolean => {
  const ageConfirmTitle = $(".list-group-item-title").first().text().trim();
  if (ageConfirmTitle.includes("あなたは18歳以上ですか？")) {
    return true;
  }

  const ageConfirmText = $(".age-confirmation-text").first().text().trim();
  if (ageConfirmText.includes("成人向けの画像、動画、テキストなどが表示される可能性があります")) {
    return true;
  }

  const confirmButton = $("input[value*='続行'], input[value*='はい、18歳以上です']").length > 0;
  if (confirmButton) {
    return true;
  }

  return false;
};

const getJsonLdValue = ($: CheerioAPI, key: string): string | undefined => {
  const scripts = $('script[type="application/ld+json"]');

  for (const script of scripts) {
    try {
      const htmlContent = $(script).html();
      if (htmlContent !== null) {
        const parsed = JSON.parse(htmlContent);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          if (item && item[key] !== undefined && item[key] !== null) {
            return String(item[key]);
          }
        }
      }
    } catch (_e) {}
  }

  return undefined;
};

const getMainImage = ($: CheerioAPI, detailUrl: string): string | undefined => {
  const ogImage = $('meta[property="og:image"]').attr("content") || "";
  const imageUrl = toAbsoluteUrl(detailUrl, ogImage);
  return imageUrl?.replace("blurred_ogp", "main");
};

const getProductPlot = ($: CheerioAPI): string | undefined => {
  const plot = $(".product-description").first().text().trim();
  return plot || getJsonLdValue($, "description");
};

const IMAGE_FILE_PATTERN = /\.(?:jpe?g|png|webp)$/iu;

const resolveImageUrl = (value: string | undefined, detailUrl: string): string | undefined => {
  const imageUrl = toAbsoluteUrl(detailUrl, value);
  if (!imageUrl) {
    return undefined;
  }

  try {
    return IMAGE_FILE_PATTERN.test(new URL(imageUrl).pathname) ? imageUrl : undefined;
  } catch {
    return undefined;
  }
};

const normalizeNumber = (value: string | undefined | null): string => {
  // Media extensions are handled by the scanner; Fantia filenames may omit the FANTIA prefix.
  // Any inferred numeric ID must still pass the detail page's content_type/content_id validation.
  const normalized = normalizeCode(value);
  const fantiaMatch = normalized.match(/FANTIA(\d{5,7})/);
  if (fantiaMatch) {
    return fantiaMatch[1];
  }
  const codeMatch = normalized.match(/([A-Z]{3,6})(\d{2,5})/);
  if (codeMatch) {
    return codeMatch[1] + codeMatch[2];
  }
  return normalized;
};

const getCsrfToken = ($: CheerioAPI): string => {
  return $('meta[name="csrf-token"]').attr("content") || "";
};

const extractImagesFromBlogComment = (data: FantiaPostApiResponse): string[] => {
  const images: string[] = [];
  try {
    if (!data.post.blog_comment) {
      return images;
    }
    const apiData = JSON.parse(data.post.blog_comment);
    const operations = apiData.ops as Array<{ insert?: { fantiaImage?: { url?: string } } }>;
    if (!operations) return images;

    for (const operation of operations) {
      const imageEmbed = operation.insert?.fantiaImage;
      if (imageEmbed?.url) {
        images.push(imageEmbed.url);
      }
    }
  } catch {
    // apiData is not valid JSON or has unexpected structure
  }
  return images;
};

const extractImagesFromPostContents = (data: FantiaPostApiResponse): string[] => {
  return (data.post.post_contents ?? []).flatMap((content) => {
    if (content.visible_status !== "visible") {
      return [];
    }

    return (content.post_content_photos ?? [])
      .map((photo) => {
        if (typeof photo.url === "string") {
          return photo.url;
        }
        return photo.url?.main ?? photo.url?.large ?? photo.url?.original ?? photo.url?.medium ?? photo.url?.thumb;
      })
      .filter((imageUrl): imageUrl is string => Boolean(imageUrl));
  });
};

const extractFantiaDetailId = (href: string): string | undefined => {
  try {
    return new URL(href, FANTIA_BASE_URL).pathname.match(/^\/(?:products|posts)\/(\d+)\/?$/u)?.[1];
  } catch {
    return undefined;
  }
};

const isExpectedDetailPage = ($: CheerioAPI, urlpath: string): boolean => {
  const pathMatch = urlpath.match(/^\/(posts|products)\/(\d+)$/u);
  if (!pathMatch) {
    return false;
  }

  const expectedType = pathMatch[1] === "posts" ? "post" : "product";
  return getJsonLdValue($, "content_type") === expectedType && getJsonLdValue($, "content_id") === pathMatch[2];
};

export class FantiaCrawler extends BaseCrawler {
  static readonly siteRequestConfigs = FANTIA_SITE_REQUEST_CONFIGS;

  site(): Website {
    return Website.FANTIA;
  }

  private async tryDirectUrl(urlpath: string, context: Context): Promise<string | null> {
    const url = `${FANTIA_BASE_URL}${urlpath}`;
    try {
      const html = await this.fetch(url, context);
      const $ = load(html);
      if (isAgeVerificationPage($)) {
        throw new Error("Fantia age verification detected; please login first via browser and provide cookies");
      }
      if (isExpectedDetailPage($, urlpath)) {
        return url;
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("Fantia age verification detected")) {
        throw error;
      }
      this.logger.debug(`Failed to fetch direct URL: ${url}`);
    }
    return null;
  }

  private async searchForUrl(number: string, urlpath: string, context: Context): Promise<string | null> {
    const url = `${FANTIA_BASE_URL}${urlpath}?brand_type=0&category=&keyword=${encodeURIComponent(number)}`;
    try {
      const html = await this.fetch(url, context);
      const $ = load(html);
      const title = $("title").text().trim();
      if (!title || title.includes("ログイン｜ファンティア[Fantia]")) {
        return null;
      }
      const href = $("a.link-block")
        .toArray()
        .map((element) => $(element).attr("href"))
        .find(
          (candidate): candidate is string =>
            typeof candidate === "string" && extractFantiaDetailId(candidate) === number,
        );
      if (href) {
        return toAbsoluteUrl(FANTIA_BASE_URL, href) ?? null;
      }
    } catch {
      this.logger.debug(`Failed to fetch search URL: ${url}`);
    }
    return null;
  }

  private async fetchPostApiData(
    $: CheerioAPI,
    detailUrl: string,
    context: Context,
  ): Promise<FantiaPostApiData | null> {
    const postIdMatch = detailUrl.match(/\/posts\/(\d+)/);
    if (!postIdMatch) {
      return null;
    }
    const postId = postIdMatch[1];
    const apiUrl = `${FANTIA_BASE_URL}/api/v1/posts/${postId}`;
    const csrfToken = getCsrfToken($);

    try {
      const data = await this.gateway.fetchJson<FantiaPostApiResponse>(apiUrl, {
        ...this.createFetchOptions(context),
        headers: {
          ...this.buildHeaders(context),
          "X-Requested-With": "XMLHttpRequest",
          "X-CSRF-Token": csrfToken,
        },
      });

      return {
        plot: data.post.comment?.trim() || undefined,
        images: [...new Set([...extractImagesFromBlogComment(data), ...extractImagesFromPostContents(data)])],
      };
    } catch (error) {
      this.logger.debug(`Failed to fetch post API data for ${postId}: ${error}`);
      return null;
    }
  }

  protected async generateSearchUrl(context: Context): Promise<string | null> {
    const number = normalizeNumber(context.number);
    if (!number) {
      return null;
    }

    const directPaths = [`/posts/${number}`, `/products/${number}`];
    for (const urlpath of directPaths) {
      const result = await this.tryDirectUrl(urlpath, context);
      if (result) {
        return result;
      }
    }

    const searchPaths = [`/posts`, `/products`];
    for (const urlpath of searchPaths) {
      const result = await this.searchForUrl(number, urlpath, context);
      if (result) {
        return result;
      }
    }

    return null;
  }

  protected async parseSearchPage(
    _context: Context,
    $: CheerioAPI,
    searchUrl: string,
  ): Promise<string | SearchPageResolution | null> {
    if (isAgeVerificationPage($)) {
      this.logger.debug("Fantia age verification detected; please login first via browser and provide cookies");
      throw new Error("Fantia age verification detected; please login first via browser and provide cookies");
    }

    return this.reuseSearchDocument(searchUrl);
  }

  protected async parseDetailPage(context: Context, $: CheerioAPI, _detailUrl: string): Promise<CrawlerData | null> {
    this.logger.debug(`url is ${_detailUrl}`);
    if (isAgeVerificationPage($)) {
      throw new Error("Fantia age verification detected; please login first via browser and provide cookies");
    }

    const number = context.number;
    const publisher = getJsonLdValue($, "fanclub_name");
    if (!publisher) {
      return null;
    }
    const actors: string[] = [];
    const tagsRaw = getJsonLdValue($, "tag");
    const tags = tagsRaw ? tagsRaw.split(",").map((tag) => tag.trim()) : [];
    const fanclubCategory = getJsonLdValue($, "fanclub_category");
    if (fanclubCategory && !tags.includes(fanclubCategory)) {
      tags.push(fanclubCategory);
    }
    const thumbUrl = getMainImage($, _detailUrl);
    if (!thumbUrl) {
      return null;
    }

    let title: string;
    let releaseDate: string | undefined;
    let plot: string | undefined;
    let allSceneImages: string[];

    if (_detailUrl.includes("/products")) {
      title = $(".product-title.mb-20").text().trim() || "";
      releaseDate = parseDate(getJsonLdValue($, "uploadDate") ?? getJsonLdValue($, "datePublished"));
      plot = getProductPlot($);
      const galleryImages = $(".product-gallery-item img")
        .toArray()
        .map((element) => resolveImageUrl($(element).attr("src") ?? $(element).attr("data-src"), _detailUrl))
        .filter((imageUrl): imageUrl is string => Boolean(imageUrl));
      allSceneImages = [...new Set([thumbUrl, ...galleryImages])];
    } else if (_detailUrl.includes("/posts")) {
      title = getJsonLdValue($, "headline") || "";
      releaseDate = parseDate(getJsonLdValue($, "datePublished"));
      const apiData = await this.fetchPostApiData($, _detailUrl, context);
      plot = apiData?.plot ?? getJsonLdValue($, "description");
      allSceneImages = apiData?.images.length ? apiData.images : [thumbUrl];
    } else {
      return null;
    }

    return {
      title,
      number,
      actors,
      genres: tags,
      publisher,
      plot,
      release_date: releaseDate,
      thumb_url: thumbUrl,
      scene_images: allSceneImages,
      website: Website.FANTIA,
    };
  }
}

export const crawlerRegistration: CrawlerRegistration = {
  site: Website.FANTIA,
  crawler: FantiaCrawler,
};

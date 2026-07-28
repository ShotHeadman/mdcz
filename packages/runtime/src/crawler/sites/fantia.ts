import fs from "node:fs/promises";
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
    comment: string;
    blog_comment: string;
  };
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

const getMainImage = ($: CheerioAPI): string | undefined => {
  const ogImage = $('meta[property="og:image"]').attr("content") || "";
  return ogImage.replace("blurred_ogp", "main");
};

const getProductPlot = ($: CheerioAPI): string | undefined => {
  const plot = $(".product-description").first().text().trim();
  return plot;
};

const normalizeNumber = (value: string | undefined | null): string => {
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

const _saveDebugHtml = async (filePath: string, html: string) => {
  try {
    await fs.writeFile(filePath, html);
    console.log(`save success: ${filePath}`);
  } catch (error) {
    console.error(`save fail: ${error}`);
  }
};

const getCsrfToken = ($: CheerioAPI): string => {
  return $('meta[name="csrf-token"]').attr("content") || "";
};

const extractImagesFromBlogComment = (data: FantiaPostApiResponse): string[] => {
  const images: string[] = [];
  try {
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
      const title = $("title").text().trim();
      if (title && !title.includes("検索") && !title.includes("ログイン｜ファンティア[Fantia]")) {
        return url;
      }
    } catch {
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
      const href = $("a.link-block").attr("href");
      if (href) {
        const fullUrl = `${FANTIA_BASE_URL}${href}`;
        return fullUrl;
      }
    } catch {
      this.logger.debug(`Failed to fetch search URL: ${url}`);
    }
    return null;
  }

  private async injectPostApiDataIntoDoc($: CheerioAPI, searchUrl: string, context: Context): Promise<void> {
    const postIdMatch = searchUrl.match(/\/posts\/(\d+)/);
    if (!postIdMatch) {
      return;
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

      const images = extractImagesFromBlogComment(data);

      const $body = $("body");
      if ($body.length > 0) {
        if (images.length > 0) {
          $body.append(`<div id="crawler-post-images" style="display:none">${JSON.stringify(images)}</div>`);
        }
        if (data.post.comment) {
          $body.append(`<div id="crawler-post-plot" style="display:none">${JSON.stringify(data.post.comment)}</div>`);
        }
      }
    } catch (error) {
      this.logger.debug(`Failed to inject post API data for ${postId}: ${error}`);
    }
  }

  protected async generateSearchUrl(context: Context): Promise<string | null> {
    const number = normalizeNumber(context.number);
    if (!number) {
      return null;
    }

    const directPaths = [`/products/${number}`, `/posts/${number}`];
    for (const urlpath of directPaths) {
      const result = await this.tryDirectUrl(urlpath, context);
      if (result) {
        return result;
      }
    }

    const searchPaths = [`/products`, `/posts`];
    for (const urlpath of searchPaths) {
      const result = await this.searchForUrl(number, urlpath, context);
      if (result) {
        return result;
      }
    }

    return null;
  }

  protected async parseSearchPage(
    context: Context,
    $: CheerioAPI,
    searchUrl: string,
  ): Promise<string | SearchPageResolution | null> {
    if (isAgeVerificationPage($)) {
      this.logger.debug("Fantia age verification detected; please login first via browser and provide cookies");
      throw new Error("Fantia age verification detected; please login first via browser and provide cookies");
    }

    await this.injectPostApiDataIntoDoc($, searchUrl, context);

    return this.reuseSearchDocument(searchUrl);
  }

  protected async parseDetailPage(context: Context, $: CheerioAPI, _detailUrl: string): Promise<CrawlerData | null> {
    this.logger.debug(`url is ${_detailUrl}`);
    // saveDebugHtml(path.join(DebugHtmlDir, `fantia_${Date.now()}.html`), $.html());
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
    const thumbUrl = getMainImage($);
    if (!thumbUrl) {
      return null;
    }

    let title: string;
    let releaseDate: string | undefined;
    let plot: string | undefined;
    let allSceneImages: string[];

    if (_detailUrl.includes("/products")) {
      title = $(".product-title.mb-20").text().trim() || "";
      releaseDate = parseDate(getJsonLdValue($, "uploadDate"));
      plot = getProductPlot($);
      const galleryImages: string[] = [];
      $(".product-gallery-item img").each((_i, el) => {
        const src = $(el).attr("src");
        if (src?.endsWith(".jpg")) {
          galleryImages.push(src);
        }
      });
      allSceneImages = [...new Set([thumbUrl, ...galleryImages])];
    } else if (_detailUrl.includes("/posts")) {
      title = getJsonLdValue($, "headline") || "";
      releaseDate = parseDate(getJsonLdValue($, "datePublished"));
      const plotEl = $("#crawler-post-plot");
      plot = plotEl.length > 0 ? JSON.parse(plotEl.text()) : getJsonLdValue($, "description");
      const imgEl = $("#crawler-post-images");
      allSceneImages = imgEl.length > 0 ? JSON.parse(imgEl.text()) : [thumbUrl];
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

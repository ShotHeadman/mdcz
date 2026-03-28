import { loggerService } from "@main/services/LoggerService";
import { InMemoryCookieJar, type NetworkClient, type NetworkSession } from "@main/services/network";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import { load } from "cheerio";

interface CheerioAttributeReader {
  attr(name: string): string | undefined;
}

const AMAZON_ORIGIN = "https://www.amazon.co.jp";
const AMAZON_BLACK_CURTAIN_BASE = `${AMAZON_ORIGIN}/black-curtain/save-eligibility/black-curtain`;
const AMAZON_IMAGE_HOST = "m.media-amazon.com";
const AMAZON_HEADERS = {
  "accept-language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
  host: "www.amazon.co.jp",
};

export interface AmazonJpPosterEnhanceResult {
  poster_url?: string;
  upgraded: boolean;
  reason: string;
}

interface DetailCandidate {
  detailPath: string;
  detailTitle: string;
}

const normalizeWhitespace = (value: string): string => value.replace(/\s+/gu, " ").trim();

const quotePlus = (value: string): string => encodeURIComponent(value).replace(/%20/gu, "+");

const encodeAmazonKeyword = (value: string): string => quotePlus(quotePlus(value.replace(/&/gu, " ")));

const normalizeCompareText = (value: string): string =>
  normalizeWhitespace(value)
    .replace(/％/gu, "%")
    .replace(/[\s[\]\-_/／・,，、:：]/gu, "")
    .toLowerCase();

const normalizeAmazonImageUrl = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed || !trimmed.includes(AMAZON_IMAGE_HOST) || !/\.(?:jpe?g|png)(?:$|[?#])/iu.test(trimmed)) {
    return null;
  }
  return trimmed;
};

const normalizeAmazonDetailPath = (value: string): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const match = trimmed.match(/\/dp\/([A-Z0-9]{10})/u);
  if (match) {
    return `/dp/${match[1]}`;
  }

  try {
    const pathname = new URL(trimmed, AMAZON_ORIGIN).pathname;
    const normalizedMatch = pathname.match(/\/dp\/([A-Z0-9]{10})/u);
    return normalizedMatch ? `/dp/${normalizedMatch[1]}` : null;
  } catch {
    return null;
  }
};

export class AmazonJpImageService {
  private readonly logger = loggerService.getLogger("AmazonJpImageService");

  constructor(private readonly networkClient: NetworkClient) {}

  async enhance(data: CrawlerData, posterSource?: Website): Promise<AmazonJpPosterEnhanceResult> {
    const currentPoster = data.poster_url?.trim();
    const skipReason = this.getSkipReason(currentPoster, posterSource);
    if (skipReason) {
      return { upgraded: false, reason: skipReason };
    }

    const searchTitle = normalizeWhitespace(data.title ?? "");
    if (!searchTitle) {
      return { upgraded: false, reason: "skip: missing title" };
    }

    const session = this.networkClient.createSession({
      cookieJar: new InMemoryCookieJar(),
    });
    const searchUrl = this.buildBlackCurtainUrl(`/s?k=${encodeAmazonKeyword(searchTitle)}&ref=nb_sb_noss`);

    let html: string;
    try {
      html = await session.getText(searchUrl, {
        headers: AMAZON_HEADERS,
      });
    } catch (error) {
      this.logger.warn(
        `Amazon search failed for "${searchTitle}": ${error instanceof Error ? error.message : String(error)}`,
      );
      return { upgraded: false, reason: "搜索请求失败" };
    }

    if (this.isNoResultPage(html)) {
      return { upgraded: false, reason: "搜索无结果" };
    }

    const detailCandidates = this.extractDetailCandidates(html, searchTitle);
    let hadUnreachableImage = false;

    for (const candidate of detailCandidates) {
      const imageUrl = await this.fetchDetailPoster(session, candidate.detailPath);
      if (!imageUrl) {
        continue;
      }

      const reachable = await this.isImageReachable(imageUrl);
      if (!reachable) {
        hadUnreachableImage = true;
        this.logger.warn(`Amazon detail image is not reachable for "${candidate.detailTitle}" (${imageUrl})`);
        continue;
      }

      return {
        poster_url: imageUrl,
        upgraded: imageUrl !== currentPoster,
        reason: imageUrl === currentPoster ? "已命中相同海报" : "已升级为Amazon商品海报",
      };
    }

    return {
      upgraded: false,
      reason: hadUnreachableImage ? "图片链接校验失败" : "搜索无结果",
    };
  }

  private getSkipReason(currentPoster: string | undefined, posterSource?: Website): string | null {
    if (!currentPoster) {
      return "skip: no current poster";
    }

    if (posterSource === Website.DMM) {
      return "skip: DMM poster source";
    }

    if (currentPoster.includes("awsimgsrc.dmm.co.jp")) {
      return "skip: AWS DMM poster";
    }

    if (currentPoster.includes(AMAZON_IMAGE_HOST)) {
      return "skip: already using Amazon poster";
    }

    return null;
  }

  private isNoResultPage(html: string): boolean {
    const lowered = html.toLowerCase();
    return (
      lowered.includes("s-no-results") ||
      html.includes("検索に一致する商品はありませんでした。") ||
      html.includes("No results for") ||
      html.includes("did not match any products")
    );
  }

  private buildBlackCurtainUrl(returnUrl: string): string {
    const url = new URL(AMAZON_BLACK_CURTAIN_BASE);
    url.searchParams.set("returnUrl", returnUrl);
    return url.toString();
  }

  private extractDetailCandidates(html: string, title: string): DetailCandidate[] {
    const $ = load(html);
    const expectedTitle = normalizeCompareText(title);
    const cards = $('div[data-component-type="s-search-result"][data-asin]');
    const matches: DetailCandidate[] = [];
    const seenPaths = new Set<string>();

    for (const card of cards.toArray()) {
      const asin = ($(card).attr("data-asin") ?? "").trim();
      const cardTitle = normalizeWhitespace($(card).find("h2 a span, h2 span").first().text());
      if (!cardTitle) {
        continue;
      }

      const detailPath = this.extractDetailPath($, card, asin);
      if (!detailPath || seenPaths.has(detailPath)) {
        continue;
      }

      const normalizedCardTitle = normalizeCompareText(cardTitle);
      if (!normalizedCardTitle.includes(expectedTitle)) {
        continue;
      }

      seenPaths.add(detailPath);
      matches.push({
        detailPath,
        detailTitle: cardTitle,
      });
    }

    return matches.slice(0, 4);
  }

  private extractDetailPath(
    $: ReturnType<typeof load>,
    card: Parameters<ReturnType<typeof load>>[0],
    asin: string,
  ): string | null {
    const hrefCandidates = [
      $(card).find("a.s-no-outline").first().attr("href") ?? "",
      $(card).find("h2 a").first().attr("href") ?? "",
      $(card).find('a[href*="/dp/"]').first().attr("href") ?? "",
      asin ? `/dp/${asin}` : "",
    ];

    for (const href of hrefCandidates) {
      const detailPath = normalizeAmazonDetailPath(href);
      if (detailPath) {
        return detailPath;
      }
    }

    return null;
  }

  private async fetchDetailPoster(session: NetworkSession, detailPath: string): Promise<string | null> {
    const detailUrl = new URL(detailPath, AMAZON_ORIGIN).toString();

    let html: string;
    try {
      html = await session.getText(detailUrl, {
        headers: AMAZON_HEADERS,
      });
    } catch (error) {
      this.logger.warn(
        `Amazon detail request failed for "${detailPath}": ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }

    return this.extractDetailPosterUrl(html);
  }

  private extractDetailPosterUrl(html: string): string | null {
    const $ = load(html);
    const selectors = [
      "#leftCol #imageBlock img",
      "#leftCol #landingImage",
      "#landingImage",
      "#imgBlkFront",
      "#ebooksImgBlkFront",
    ];

    for (const selector of selectors) {
      for (const node of $(selector).toArray()) {
        const imageUrl = this.extractImageUrlFromNode($(node));
        if (imageUrl) {
          return imageUrl;
        }
      }
    }

    return null;
  }

  private extractImageUrlFromNode(node: CheerioAttributeReader): string | null {
    const oldHires = normalizeAmazonImageUrl(node.attr("data-old-hires") ?? "");
    if (oldHires) {
      return oldHires;
    }

    const src = normalizeAmazonImageUrl(node.attr("src") ?? "");
    if (src) {
      return src;
    }

    return this.extractDynamicImageUrl(node.attr("data-a-dynamic-image") ?? "");
  }

  private extractDynamicImageUrl(value: string): string | null {
    if (!value) {
      return null;
    }

    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      const candidates = Object.entries(parsed)
        .map(([url, size]) => ({
          url: normalizeAmazonImageUrl(url),
          area: Array.isArray(size) && size.length >= 2 ? Number(size[0]) * Number(size[1]) : 0,
        }))
        .filter((entry): entry is { url: string; area: number } => entry.url !== null)
        .sort((left, right) => right.area - left.area);
      return candidates[0]?.url ?? null;
    } catch {
      return null;
    }
  }

  private async isImageReachable(url: string): Promise<boolean> {
    try {
      const response = await this.networkClient.head(url);
      return response.ok;
    } catch {
      return false;
    }
  }
}

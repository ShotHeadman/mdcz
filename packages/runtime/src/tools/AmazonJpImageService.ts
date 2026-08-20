import { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import { load } from "cheerio";
import type { NetworkCookieJar, NetworkSession, RuntimeNetworkClient } from "../network";
import { InMemoryCookieJar } from "../network/InMemoryCookieJar";
import { noopRuntimeLogger, type RuntimeLogger, toErrorMessage } from "../shared";

interface CheerioAttributeReader {
  attr(name: string): string | undefined;
}

export interface AmazonJpNetworkClient extends RuntimeNetworkClient {
  createSession(options?: { cookieJar?: NetworkCookieJar }): NetworkSession;
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
  if (!trimmed.includes(AMAZON_IMAGE_HOST) || !/\.(?:jpe?g|png)(?:$|[?#])/iu.test(trimmed)) return null;
  return trimmed.replace(/\._[A-Z0-9_,]+_\.(jpe?g|png)([?#].*)?$/iu, "._AC_SL1500_.$1$2");
};

const normalizeAmazonDetailPath = (value: string): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^[A-Z0-9]{10}$/u.test(trimmed)) return `/dp/${trimmed}`;
  const match = trimmed.match(/\/dp\/([A-Z0-9]{10})/u);
  if (match) return `/dp/${match[1]}`;
  try {
    const normalizedMatch = new URL(trimmed, AMAZON_ORIGIN).pathname.match(/\/dp\/([A-Z0-9]{10})/u);
    return normalizedMatch ? `/dp/${normalizedMatch[1]}` : null;
  } catch {
    return null;
  }
};

const extractAsinFromDetailPath = (detailPath: string): string | null =>
  detailPath.match(/^\/dp\/([A-Z0-9]{10})$/u)?.[1] ?? null;

export class AmazonJpImageService {
  constructor(
    private readonly networkClient: AmazonJpNetworkClient,
    private readonly logger: Pick<RuntimeLogger, "warn"> = noopRuntimeLogger,
  ) {}

  async enhance(data: CrawlerData, posterSource?: Website): Promise<AmazonJpPosterEnhanceResult> {
    const currentPoster = data.poster_url?.trim();
    const skipReason = this.getSkipReason(currentPoster, posterSource);
    if (skipReason) return { upgraded: false, reason: skipReason };

    const searchTitle = normalizeWhitespace(data.title ?? "");
    if (!searchTitle) return { upgraded: false, reason: "skip: missing title" };

    const session = this.networkClient.createSession({ cookieJar: new InMemoryCookieJar() });
    const directDetailPath = normalizeAmazonDetailPath(searchTitle);
    if (directDetailPath) return this.enhanceFromDirectDetailPath(session, directDetailPath, currentPoster);

    let html: string;
    try {
      html = await session.getText(
        this.buildBlackCurtainUrl(`/s?k=${encodeAmazonKeyword(searchTitle)}&ref=nb_sb_noss`),
        {
          headers: AMAZON_HEADERS,
        },
      );
    } catch (error) {
      this.logger.warn(`Amazon search failed for "${searchTitle}": ${toErrorMessage(error)}`);
      return { upgraded: false, reason: "搜索请求失败" };
    }

    if (this.isNoResultPage(html)) return { upgraded: false, reason: "搜索无结果" };
    const searchResultCount = this.countSearchResultCards(html);
    const detailCandidates = this.extractDetailCandidates(html, searchTitle);
    if (detailCandidates.length === 0) {
      return { upgraded: false, reason: searchResultCount > 0 ? "未找到匹配商品" : "搜索无结果" };
    }

    let hadUnreachableImage = false;
    for (const candidate of detailCandidates) {
      const imageUrl = await this.fetchDetailPoster(session, candidate.detailPath);
      if (!imageUrl) continue;
      if (!(await this.isImageReachable(imageUrl))) {
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

    return { upgraded: false, reason: hadUnreachableImage ? "图片链接校验失败" : "Amazon 商品页无法读取" };
  }

  private async enhanceFromDirectDetailPath(
    session: NetworkSession,
    detailPath: string,
    currentPoster: string | undefined,
  ): Promise<AmazonJpPosterEnhanceResult> {
    const directImageUrl = await this.fetchDetailPoster(session, detailPath, { useEligibilityGate: true });
    const imageUrl = directImageUrl ?? (await this.fetchPosterViaAsinSearch(session, detailPath));
    if (!imageUrl) return { upgraded: false, reason: "Amazon 商品页无法读取" };
    if (!(await this.isImageReachable(imageUrl))) {
      this.logger.warn(`Amazon detail image is not reachable for "${detailPath}" (${imageUrl})`);
      return { upgraded: false, reason: "图片链接校验失败" };
    }
    return {
      poster_url: imageUrl,
      upgraded: imageUrl !== currentPoster,
      reason: imageUrl === currentPoster ? "已命中相同海报" : "已升级为Amazon商品海报",
    };
  }

  private async fetchPosterViaAsinSearch(session: NetworkSession, detailPath: string): Promise<string | null> {
    const asin = extractAsinFromDetailPath(detailPath);
    if (!asin) return null;
    let html: string;
    try {
      html = await session.getText(this.buildBlackCurtainUrl(`/s?k=${asin}&ref=nb_sb_noss`), {
        headers: AMAZON_HEADERS,
      });
    } catch (error) {
      this.logger.warn(`Amazon ASIN search failed for "${asin}": ${toErrorMessage(error)}`);
      return null;
    }
    const candidate = this.extractAsinCandidate(html, asin);
    return candidate ? this.fetchDetailPoster(session, candidate.detailPath) : null;
  }

  private getSkipReason(currentPoster: string | undefined, posterSource?: Website): string | null {
    if (!currentPoster) return "skip: no current poster";
    if (posterSource === Website.DMM) return "skip: DMM poster source";
    if (currentPoster.includes("awsimgsrc.dmm.co.jp")) return "skip: AWS DMM poster";
    if (currentPoster.includes(AMAZON_IMAGE_HOST)) return "skip: already using Amazon poster";
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

  private countSearchResultCards(html: string): number {
    return load(html)('div[data-component-type="s-search-result"][data-asin]').length;
  }

  private extractDetailCandidates(html: string, title: string): DetailCandidate[] {
    const $ = load(html);
    const expectedTitle = normalizeCompareText(title);
    const matches: DetailCandidate[] = [];
    const seenPaths = new Set<string>();
    for (const card of $('div[data-component-type="s-search-result"][data-asin]').toArray()) {
      const asin = ($(card).attr("data-asin") ?? "").trim();
      const cardTitle = normalizeWhitespace($(card).find("h2 a span, h2 span").first().text());
      if (!cardTitle) continue;
      const detailPath = this.extractDetailPath($, card, asin);
      if (!detailPath || seenPaths.has(detailPath) || !normalizeCompareText(cardTitle).includes(expectedTitle))
        continue;
      seenPaths.add(detailPath);
      matches.push({ detailPath, detailTitle: cardTitle });
    }
    return matches.slice(0, 4);
  }

  private extractAsinCandidate(html: string, asin: string): DetailCandidate | null {
    const $ = load(html);
    for (const card of $('div[data-component-type="s-search-result"][data-asin]').toArray()) {
      const cardAsin = ($(card).attr("data-asin") ?? "").trim();
      if (cardAsin !== asin) continue;
      const detailPath = this.extractDetailPath($, card, cardAsin);
      if (detailPath) {
        return { detailPath, detailTitle: normalizeWhitespace($(card).find("h2 a span, h2 span").first().text()) };
      }
    }
    return null;
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
      if (detailPath) return detailPath;
    }
    return null;
  }

  private async fetchDetailPoster(
    session: NetworkSession,
    detailPath: string,
    options: { useEligibilityGate?: boolean } = {},
  ): Promise<string | null> {
    const detailUrl = options.useEligibilityGate
      ? this.buildBlackCurtainUrl(detailPath)
      : new URL(detailPath, AMAZON_ORIGIN).toString();
    try {
      const html = await session.getText(detailUrl, { headers: AMAZON_HEADERS });
      return this.extractDetailPosterUrl(html);
    } catch (error) {
      this.logger.warn(`Amazon detail request failed for "${detailPath}": ${toErrorMessage(error)}`);
      return null;
    }
  }

  private extractDetailPosterUrl(html: string): string | null {
    const $ = load(html);
    for (const selector of [
      "#leftCol #imageBlock img",
      "#leftCol #landingImage",
      "#landingImage",
      "#imgBlkFront",
      "#ebooksImgBlkFront",
    ]) {
      for (const node of $(selector).toArray()) {
        const imageUrl = this.extractImageUrlFromNode($(node));
        if (imageUrl) return imageUrl;
      }
    }
    return null;
  }

  private extractImageUrlFromNode(node: CheerioAttributeReader): string | null {
    const oldHires = normalizeAmazonImageUrl(node.attr("data-old-hires") ?? "");
    if (oldHires) return oldHires;
    const dynamicImage = this.extractDynamicImageUrl(node.attr("data-a-dynamic-image") ?? "");
    if (dynamicImage) return dynamicImage;
    return normalizeAmazonImageUrl(node.attr("src") ?? "");
  }

  private extractDynamicImageUrl(value: string): string | null {
    if (!value) return null;
    try {
      return (
        Object.entries(JSON.parse(value) as Record<string, unknown>)
          .map(([url, size]) => ({
            url: normalizeAmazonImageUrl(url),
            area: Array.isArray(size) && size.length >= 2 ? Number(size[0]) * Number(size[1]) : 0,
          }))
          .filter((entry): entry is { url: string; area: number } => entry.url !== null)
          .sort((left, right) => right.area - left.area)[0]?.url ?? null
      );
    } catch {
      return null;
    }
  }

  private async isImageReachable(url: string): Promise<boolean> {
    try {
      return (await this.networkClient.head(url)).ok;
    } catch {
      return false;
    }
  }
}

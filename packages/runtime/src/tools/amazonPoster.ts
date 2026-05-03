import { randomUUID } from "node:crypto";
import { readdir, readFile, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { buildMovieAssetFileNames, isMovieNfoBaseName, MOVIE_NFO_BASE_NAME } from "@mdcz/shared/assetNaming";
import type {
  AmazonPosterApplyResultItem,
  AmazonPosterLookupResult,
  AmazonPosterScanItem,
} from "@mdcz/shared/ipcTypes";
import type { CrawlerData } from "@mdcz/shared/types";
import { load } from "cheerio";
import type { RuntimeDownloadNetworkClient, RuntimeNetworkClient } from "../network";
import { parseNfo } from "../scrape/nfo";
import { validateImage } from "../scrape/utils/image";

const POSTER_FILE_NAME = "poster.jpg";
const AMAZON_ORIGIN = "https://www.amazon.co.jp";
const AMAZON_BLACK_CURTAIN_BASE = `${AMAZON_ORIGIN}/black-curtain/save-eligibility/black-curtain`;
const AMAZON_IMAGE_HOST = "m.media-amazon.com";
const AMAZON_HEADERS = {
  "accept-language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
  host: "www.amazon.co.jp",
};

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
  return trimmed;
};

const normalizeAmazonDetailPath = (value: string): string | null => {
  const match = value.trim().match(/\/dp\/([A-Z0-9]{10})/u);
  if (match) return `/dp/${match[1]}`;
  try {
    return new URL(value, AMAZON_ORIGIN).pathname.match(/\/dp\/([A-Z0-9]{10})/u)?.[0] ?? null;
  } catch {
    return null;
  }
};

const toErrorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const uniqueDefinedPaths = (paths: Array<string | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    if (!path || seen.has(path)) continue;
    seen.add(path);
    result.push(path);
  }
  return result;
};

const resolveLocalAssetReference = (directory: string, value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  if (!normalized || /^https?:\/\//iu.test(normalized)) return undefined;
  return isAbsolute(normalized) ? normalized : join(directory, normalized);
};

const buildPosterCandidatePaths = (
  directory: string,
  nfoPath: string,
  parsed: CrawlerData,
  allowFixedPosterFallback: boolean,
): string[] => {
  const nfoBaseName = basename(nfoPath, extname(nfoPath));
  return uniqueDefinedPaths([
    resolveLocalAssetReference(directory, parsed.poster_url),
    allowFixedPosterFallback ? join(directory, POSTER_FILE_NAME) : undefined,
    nfoBaseName && !isMovieNfoBaseName(nfoBaseName)
      ? join(directory, buildMovieAssetFileNames(nfoBaseName, "followVideo").poster)
      : undefined,
  ]);
};

const listNfoFiles = async (rootDirectory: string): Promise<string[]> => {
  const outputs: string[] = [];
  const stack = [rootDirectory];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    for (const entry of entries) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) stack.push(entryPath);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === ".nfo") outputs.push(entryPath);
    }
  }
  return outputs;
};

const countNamedNfoFiles = async (directory: string): Promise<number> => {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.reduce((count, entry) => {
    if (!entry.isFile() || extname(entry.name).toLowerCase() !== ".nfo") return count;
    return basename(entry.name, extname(entry.name)).toLowerCase() === MOVIE_NFO_BASE_NAME ? count : count + 1;
  }, 0);
};

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
};

const findCurrentPosterPath = async (
  directory: string,
  nfoPath: string,
  parsed: CrawlerData,
  allowFixedPosterFallback: boolean,
): Promise<string | null> => {
  for (const candidatePath of buildPosterCandidatePaths(directory, nfoPath, parsed, allowFixedPosterFallback)) {
    try {
      if ((await stat(candidatePath)).isFile()) return candidatePath;
    } catch {}
  }
  return null;
};

export const scanAmazonPosters = async (rootDirectory: string): Promise<AmazonPosterScanItem[]> => {
  const normalizedRoot = resolve(rootDirectory.trim());
  if (!(await stat(normalizedRoot)).isDirectory()) throw new Error(`Directory not found: ${normalizedRoot}`);
  const nfoPaths = await listNfoFiles(normalizedRoot);
  const directoryNamedNfoCounts = new Map<string, number>();
  for (const nfoPath of nfoPaths) {
    const directory = dirname(nfoPath);
    const nfoBaseName = basename(nfoPath, extname(nfoPath)).toLowerCase();
    if (nfoBaseName !== MOVIE_NFO_BASE_NAME) {
      directoryNamedNfoCounts.set(directory, (directoryNamedNfoCounts.get(directory) ?? 0) + 1);
    }
  }

  const items: AmazonPosterScanItem[] = [];
  for (const nfoPath of nfoPaths) {
    const xml = await readFile(nfoPath, "utf8");
    const parsed = parseNfo(xml, nfoPath);
    const directory = dirname(nfoPath);
    const currentPosterPath = await findCurrentPosterPath(
      directory,
      nfoPath,
      parsed,
      (directoryNamedNfoCounts.get(directory) ?? 0) <= 1,
    );
    let currentPosterWidth = 0;
    let currentPosterHeight = 0;
    let currentPosterSize = 0;
    if (currentPosterPath) {
      const posterStats = await stat(currentPosterPath).catch(() => null);
      if (posterStats?.isFile()) {
        currentPosterSize = posterStats.size;
        const validation = await validateImage(currentPosterPath).catch(() => null);
        if (validation?.valid) {
          currentPosterWidth = validation.width;
          currentPosterHeight = validation.height;
        }
      }
    }
    items.push({
      nfoPath,
      directory,
      title: parsed.title,
      number: parsed.number,
      currentPosterPath,
      currentPosterWidth,
      currentPosterHeight,
      currentPosterSize,
    });
  }
  return items.sort((left, right) => left.nfoPath.localeCompare(right.nfoPath, "zh-CN"));
};

const buildBlackCurtainUrl = (returnUrl: string): string => {
  const url = new URL(AMAZON_BLACK_CURTAIN_BASE);
  url.searchParams.set("returnUrl", returnUrl);
  return url.toString();
};

const extractImageUrlFromNode = (node: { attr(name: string): string | undefined }): string | null => {
  const oldHires = normalizeAmazonImageUrl(node.attr("data-old-hires") ?? "");
  if (oldHires) return oldHires;
  const src = normalizeAmazonImageUrl(node.attr("src") ?? "");
  if (src) return src;
  try {
    const parsed = JSON.parse(node.attr("data-a-dynamic-image") ?? "") as Record<string, unknown>;
    return (
      Object.entries(parsed)
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
};

const extractDetailPosterUrl = (html: string): string | null => {
  const $ = load(html);
  for (const selector of ["#leftCol #imageBlock img", "#leftCol #landingImage", "#landingImage", "#imgBlkFront"]) {
    for (const node of $(selector).toArray()) {
      const imageUrl = extractImageUrlFromNode($(node));
      if (imageUrl) return imageUrl;
    }
  }
  return null;
};

export const lookupAmazonPoster = async (
  networkClient: RuntimeNetworkClient,
  nfoPath: string,
  title: string,
): Promise<AmazonPosterLookupResult> => {
  const normalizedNfoPath = resolve(nfoPath.trim());
  const startedAt = Date.now();
  try {
    const searchTitle = normalizeWhitespace(title);
    const searchHtml = await networkClient.getText(
      buildBlackCurtainUrl(`/s?k=${encodeAmazonKeyword(searchTitle)}&ref=nb_sb_noss`),
      { headers: AMAZON_HEADERS },
    );
    const expectedTitle = normalizeCompareText(searchTitle);
    const $ = load(searchHtml);
    const detailPaths = new Set<string>();
    for (const card of $('div[data-component-type="s-search-result"][data-asin]').toArray()) {
      const cardTitle = normalizeWhitespace($(card).find("h2 a span, h2 span").first().text());
      const asin = ($(card).attr("data-asin") ?? "").trim();
      const href =
        $(card).find("a.s-no-outline").first().attr("href") ??
        $(card).find("h2 a").first().attr("href") ??
        (asin ? `/dp/${asin}` : "");
      const detailPath = normalizeAmazonDetailPath(href);
      if (detailPath && normalizeCompareText(cardTitle).includes(expectedTitle)) detailPaths.add(detailPath);
    }
    for (const detailPath of [...detailPaths].slice(0, 4)) {
      const html = await networkClient.getText(new URL(detailPath, AMAZON_ORIGIN).toString(), {
        headers: AMAZON_HEADERS,
      });
      const amazonPosterUrl = extractDetailPosterUrl(html);
      if (!amazonPosterUrl) continue;
      if (networkClient.head && !(await networkClient.head(amazonPosterUrl)).ok) continue;
      return {
        nfoPath: normalizedNfoPath,
        amazonPosterUrl,
        reason: "已查询到 Amazon 商品海报",
        elapsedMs: Date.now() - startedAt,
      };
    }
    return {
      nfoPath: normalizedNfoPath,
      amazonPosterUrl: null,
      reason: "搜索无结果",
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      nfoPath: normalizedNfoPath,
      amazonPosterUrl: null,
      reason: `查询失败: ${toErrorText(error)}`,
      elapsedMs: Date.now() - startedAt,
    };
  }
};

export const applyAmazonPosters = async (
  networkClient: RuntimeDownloadNetworkClient,
  items: Array<{ nfoPath: string; amazonPosterUrl: string }>,
): Promise<AmazonPosterApplyResultItem[]> => {
  const results: AmazonPosterApplyResultItem[] = [];
  for (const item of items) {
    const normalizedNfoPath = resolve(item.nfoPath.trim());
    const directory = dirname(normalizedNfoPath);
    let savedPosterPath = join(directory, POSTER_FILE_NAME);
    let replacedExisting = false;
    try {
      const parsedNfo = parseNfo(await readFile(normalizedNfoPath, "utf8"), normalizedNfoPath);
      savedPosterPath =
        buildPosterCandidatePaths(
          directory,
          normalizedNfoPath,
          parsedNfo,
          (await countNamedNfoFiles(directory)) <= 1,
        )[0] ?? savedPosterPath;
      replacedExisting = await pathExists(savedPosterPath);
      const tempPosterPath = join(directory, `.amazon-poster-${randomUUID()}.jpg`);
      try {
        await networkClient.download(item.amazonPosterUrl.trim(), tempPosterPath);
        const validation = await validateImage(tempPosterPath);
        if (!validation.valid) throw new Error(`Image validation failed: ${validation.reason ?? "parse_failed"}`);
        if (replacedExisting) await unlink(savedPosterPath).catch(() => undefined);
        await rename(tempPosterPath, savedPosterPath);
      } catch (error) {
        await unlink(tempPosterPath).catch(() => undefined);
        throw error;
      }
      results.push({
        directory,
        success: true,
        savedPosterPath,
        replacedExisting,
        fileSize: (await stat(savedPosterPath)).size,
      });
    } catch (error) {
      results.push({
        directory,
        success: false,
        savedPosterPath,
        replacedExisting,
        fileSize: 0,
        error: toErrorText(error),
      });
    }
  }
  return results;
};

import { loggerService } from "@main/services/LoggerService";
import type { SiteRequestConfig } from "@main/services/network";
import { toErrorMessage } from "@main/utils/common";
import { uniqueStrings } from "@main/utils/strings";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import { load } from "cheerio";
import type { AdapterDependencies, CrawlerInput, CrawlerResponse, FailureReason, SiteAdapter } from "../base/types";
import type { FetchOptions } from "../FetchGateway";
import type { CrawlerRegistration } from "../registration";

const AVWIKIDB_BASE_URL = "https://avwikidb.com";
const AVWIKIDB_ACCEPT_LANGUAGE = "ja,en-US;q=0.9,en;q=0.8";
const AVWIKIDB_SITE_REQUEST_CONFIGS: readonly SiteRequestConfig[] = [
  {
    id: "avwikidb",
    matches: (url) => url.hostname === "avwikidb.com" || url.hostname.endsWith(".avwikidb.com"),
    headers: (url): Record<string, string> => {
      const isNextDataRequest = url.pathname.startsWith("/_next/data/") && url.pathname.endsWith(".json");
      return isNextDataRequest
        ? {
            accept: "application/json, text/plain, */*",
            "accept-language": AVWIKIDB_ACCEPT_LANGUAGE,
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
          }
        : {
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "accept-language": AVWIKIDB_ACCEPT_LANGUAGE,
            "sec-fetch-dest": "document",
            "sec-fetch-mode": "navigate",
            "sec-fetch-site": "none",
            "sec-fetch-user": "?1",
            "upgrade-insecure-requests": "1",
          };
    },
  },
];
const RELATION_KEYS = ["actor", "histrion", "director", "maker", "label", "series", "genre"] as const;

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const first = (...values: Array<string | undefined>): string | undefined => values.find((value) => value);

const readRecord = (record: JsonRecord | undefined, key: string): JsonRecord | undefined => {
  const value = record?.[key];
  return isRecord(value) ? value : undefined;
};

const readPageProps = (payload: unknown): JsonRecord | undefined => {
  if (!isRecord(payload)) {
    return undefined;
  }

  const direct = readRecord(payload, "pageProps");
  if (direct) {
    return direct;
  }

  return readRecord(readRecord(payload, "props"), "pageProps");
};

const nameFromRecord = (record: JsonRecord, relationKeys: readonly string[] = RELATION_KEYS): string | undefined => {
  const direct = asString(record.name) ?? asString(record.nameEn);
  if (direct) {
    return direct;
  }

  for (const key of relationKeys) {
    const nested = readRecord(record, key);
    const name = nested ? nameFromRecord(nested, relationKeys) : undefined;
    if (name) {
      return name;
    }
  }

  return undefined;
};

const extractNames = (value: unknown, relationKeys?: readonly string[]): string[] => {
  if (Array.isArray(value)) {
    return uniqueStrings(
      value.map((item) => {
        if (typeof item === "string") {
          return asString(item);
        }
        return isRecord(item) ? nameFromRecord(item, relationKeys) : undefined;
      }),
    );
  }

  if (typeof value === "string") {
    return uniqueStrings([value]);
  }

  return isRecord(value) ? uniqueStrings([nameFromRecord(value, relationKeys)]) : [];
};

const readItemInfoNames = (itemInfo: JsonRecord | undefined, key: string): string[] => extractNames(itemInfo?.[key]);

const firstName = (...groups: string[][]): string | undefined => {
  for (const group of groups) {
    if (group[0]) {
      return group[0];
    }
  }
  return undefined;
};

const parseDate = (value: unknown): string | undefined => {
  const raw = asString(value);
  if (!raw) {
    return undefined;
  }

  const dateMatch = raw.match(/\d{4}-\d{2}-\d{2}/u);
  if (dateMatch) {
    return dateMatch[0];
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString().slice(0, 10);
};

const parseMinutesToSeconds = (value: unknown): number | undefined => {
  const raw = asString(value);
  if (!raw) {
    return undefined;
  }

  const matched = raw.match(/\d+/u);
  if (!matched) {
    return undefined;
  }

  const minutes = Number.parseInt(matched[0], 10);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : undefined;
};

const readImageUrl = (imageUrl: unknown, keys: string[]): string | undefined => {
  if (typeof imageUrl === "string") {
    return asString(imageUrl);
  }
  if (!isRecord(imageUrl)) {
    return undefined;
  }

  for (const key of keys) {
    const value = asString(imageUrl[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
};

const readImageArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return uniqueStrings(value.map((item) => asString(item)));
  }

  if (!isRecord(value)) {
    return [];
  }

  return readImageArray(value.image);
};

const readSceneImages = (sampleImageUrl: unknown): string[] => {
  if (!isRecord(sampleImageUrl)) {
    return [];
  }

  return uniqueStrings([...readImageArray(sampleImageUrl.sample_l), ...readImageArray(sampleImageUrl.sample_s)]);
};

const readSampleVideoUrlsJson = (value: unknown): string | undefined => {
  const raw = asString(value);
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    const values = collectUrlStrings(parsed);
    return values[0];
  } catch {
    return undefined;
  }
};

const collectUrlStrings = (value: unknown): string[] => {
  if (typeof value === "string") {
    return /^https?:\/\//iu.test(value) ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectUrlStrings(item));
  }
  if (!isRecord(value)) {
    return [];
  }

  return Object.values(value).flatMap((item) => collectUrlStrings(item));
};

const readTrailerUrl = (movie: JsonRecord, dmmData: JsonRecord | undefined): string | undefined => {
  return first(
    asString(movie.sampleVideoBestUrl),
    readSampleVideoUrlsJson(movie.sampleVideoUrlsJson),
    ...collectUrlStrings(dmmData?.sampleMovieURL),
  );
};

const stripTrailingActorNames = (value: string, actors: string[]): string => {
  const actorNames = uniqueStrings(actors.map((actor) => asString(actor))).sort((a, b) => b.length - a.length);
  const title = value.trim();

  for (const actor of actorNames) {
    for (const separator of [" ", "　"]) {
      const suffix = `${separator}${actor}`;
      if (title.endsWith(suffix)) {
        return title.slice(0, -suffix.length).trim();
      }
    }
  }

  return title;
};

const normalizeNumber = (value: string): string => value.trim().toUpperCase();

const isNotFoundError = (message: string): boolean => /\bHTTP 404\b|Detail URL not found/iu.test(message);

const readDetailNumberFromUrl = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/work\/([^/]+)\/?$/u);
    return match?.[1] ? normalizeNumber(decodeURIComponent(match[1])) : null;
  } catch {
    return null;
  }
};

const classifyFailure = (message: string): FailureReason => {
  if (/region blocked|forbidden|HTTP 403/iu.test(message)) {
    return "region_blocked";
  }
  if (/timeout|timed out|abort/iu.test(message)) {
    return "timeout";
  }
  if (isNotFoundError(message)) {
    return "not_found";
  }
  if (/parse|metadata/iu.test(message)) {
    return "parse_error";
  }
  return "unknown";
};

export class AvwikidbCrawler implements SiteAdapter {
  static readonly siteRequestConfigs = AVWIKIDB_SITE_REQUEST_CONFIGS;

  private readonly logger = loggerService.getLogger("AvwikidbCrawler");
  private readonly gateway: AdapterDependencies["gateway"];
  private buildId: string | null = null;

  constructor(dependencies: AdapterDependencies) {
    this.gateway = dependencies.gateway;
  }

  site(): Website {
    return Website.AVWIKIDB;
  }

  async crawl(input: CrawlerInput): Promise<CrawlerResponse> {
    const startedAt = Date.now();

    try {
      const data = await this.fetchMetadata(input);
      if (!data) {
        return {
          input,
          elapsedMs: Date.now() - startedAt,
          result: {
            success: false,
            error: `Detail URL not found for ${input.number}`,
            failureReason: "not_found",
          },
        };
      }

      return {
        input,
        elapsedMs: Date.now() - startedAt,
        result: {
          success: true,
          data,
        },
      };
    } catch (error) {
      const message = toErrorMessage(error);
      this.logger.warn(`Crawler failed for ${input.number}: ${message}`);
      return {
        input,
        elapsedMs: Date.now() - startedAt,
        result: {
          success: false,
          error: message,
          failureReason: classifyFailure(message),
          cause: error,
        },
      };
    }
  }

  private async fetchMetadata(input: CrawlerInput): Promise<CrawlerData | null> {
    return this.fetchMetadataWithCurrentSession(input);
  }

  private async fetchMetadataWithCurrentSession(input: CrawlerInput): Promise<CrawlerData | null> {
    const detailNumber = readDetailNumberFromUrl(input.options?.detailUrl);
    if (detailNumber) {
      return this.fetchWorkData(detailNumber, input);
    }

    const number = normalizeNumber(input.number);
    const cachedBuildId = this.buildId;

    const direct = await this.fetchWorkData(number, input);
    if (direct) {
      return direct;
    }

    if (cachedBuildId) {
      this.buildId = null;
      const retry = await this.fetchWorkData(number, input);
      if (retry) {
        return retry;
      }
    }

    const redirectedNumber = await this.fetchSearchRedirect(number, input);
    if (!redirectedNumber || redirectedNumber === number) {
      return null;
    }

    return this.fetchWorkData(redirectedNumber, input);
  }

  private async fetchSearchRedirect(number: string, input: CrawlerInput): Promise<string | null> {
    const buildId = await this.resolveBuildId(input);
    const url = this.buildDataUrl(`search.json`, { q: number });
    const payload = await this.gateway.fetchJson<unknown>(url, this.createFetchOptions(input));

    const redirect = isRecord(payload) ? asString(payload.__N_REDIRECT) : undefined;
    const matched = redirect?.match(/^\/work\/([^/]+)\/?$/u);
    if (matched?.[1]) {
      return normalizeNumber(decodeURIComponent(matched[1]));
    }

    const pageProps = readPageProps(payload);
    const movie = readRecord(pageProps, "movie");
    const movieNumber = first(asString(movie?.adultVideoId), asString(movie?.adultVideoAlias));
    if (movieNumber) {
      return normalizeNumber(movieNumber);
    }

    this.logger.debug(`No avwikidb redirect found for ${number} with build ${buildId}`);
    return null;
  }

  private async fetchWorkData(number: string, input: CrawlerInput): Promise<CrawlerData | null> {
    try {
      await this.resolveBuildId(input);
      const url = this.buildDataUrl(`work/${encodeURIComponent(number)}.json`);
      const payload = await this.gateway.fetchJson<unknown>(url, this.createFetchOptions(input));
      const data = this.parseWorkPayload(payload, number);
      return data;
    } catch (error) {
      const message = toErrorMessage(error);
      if (isNotFoundError(message)) {
        return null;
      }
      throw error;
    }
  }

  private parseWorkPayload(payload: unknown, fallbackNumber: string): CrawlerData | null {
    const pageProps = readPageProps(payload);
    const movie = readRecord(pageProps, "movie");
    if (!movie) {
      return null;
    }

    const dmmData = readRecord(pageProps, "dmmData");
    const itemInfo = readRecord(dmmData, "iteminfo");
    const actors = uniqueStrings([...extractNames(movie.actor, ["actor"]), ...readItemInfoNames(itemInfo, "actress")]);
    const rawTitle = first(asString(movie.title), asString(dmmData?.title));
    const title = rawTitle ? stripTrailingActorNames(rawTitle, actors) : undefined;
    if (!title) {
      return null;
    }

    const genres = uniqueStrings([...extractNames(movie.genre, ["genre"]), ...readItemInfoNames(itemInfo, "genre")]);
    const imageUrl = dmmData?.imageURL;

    return {
      title,
      number: first(asString(movie.adultVideoId), asString(dmmData?.product_id), fallbackNumber) ?? fallbackNumber,
      actors,
      genres,
      studio: firstName(extractNames(movie.maker, ["maker"]), readItemInfoNames(itemInfo, "maker")),
      director: firstName(extractNames(movie.director, ["director"]), readItemInfoNames(itemInfo, "director")),
      publisher: firstName(extractNames(movie.label, ["label"]), readItemInfoNames(itemInfo, "label")),
      series: firstName(extractNames(movie.series, ["series"]), readItemInfoNames(itemInfo, "series")),
      plot: first(asString(itemInfo?.description), asString(movie.summary)),
      release_date: first(parseDate(movie.dateOfPublication), parseDate(dmmData?.date)),
      durationSeconds: parseMinutesToSeconds(dmmData?.volume),
      thumb_url: first(asString(movie.imageL), readImageUrl(imageUrl, ["large", "list", "small"])),
      poster_url: first(readImageUrl(imageUrl, ["small", "list", "large"]), asString(movie.imageL)),
      scene_images: readSceneImages(dmmData?.sampleImageURL),
      trailer_url: readTrailerUrl(movie, dmmData),
      website: Website.AVWIKIDB,
    };
  }

  private async resolveBuildId(input: CrawlerInput): Promise<string> {
    if (this.buildId) {
      return this.buildId;
    }

    const html = await this.gateway.fetchHtml(`${AVWIKIDB_BASE_URL}/`, this.createFetchOptions(input));
    const $ = load(html);
    const nextDataText = $("#__NEXT_DATA__").text().trim();
    if (!nextDataText) {
      throw new Error("avwikidb metadata build id missing");
    }

    const nextData = JSON.parse(nextDataText) as unknown;
    const buildId = isRecord(nextData) ? asString(nextData.buildId) : undefined;
    if (!buildId) {
      throw new Error("avwikidb metadata build id missing");
    }

    this.buildId = buildId;
    return buildId;
  }

  private buildDataUrl(path: string, query?: Record<string, string>): string {
    const buildId = this.buildId;
    if (!buildId) {
      throw new Error("avwikidb build id not resolved");
    }

    const url = new URL(`/_next/data/${encodeURIComponent(buildId)}/${path}`, AVWIKIDB_BASE_URL);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private createFetchOptions(input: CrawlerInput): FetchOptions {
    return {
      timeout: input.options?.timeoutMs,
      signal: input.options?.signal,
      cookies: input.options?.cookies,
    };
  }
}

export const crawlerRegistration: CrawlerRegistration = {
  site: Website.AVWIKIDB,
  crawler: AvwikidbCrawler,
};

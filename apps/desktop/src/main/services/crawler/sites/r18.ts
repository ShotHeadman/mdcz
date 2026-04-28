import { toErrorMessage } from "@main/utils/common";
import { normalizeText } from "@main/utils/normalization";
import { uniqueStrings } from "@main/utils/strings";
import { Website } from "@mdcz/shared/enums";
import { DEFAULT_R18_METADATA_LANGUAGE, type R18MetadataLanguage } from "@mdcz/shared/r18";
import type { CrawlerData } from "@mdcz/shared/types";
import { parseDate } from "../base/parser";
import type {
  AdapterDependencies,
  CrawlerInput,
  CrawlerResponse,
  CrawlerResult,
  FailureReason,
  SiteAdapter,
} from "../base/types";
import type { FetchGateway } from "../FetchGateway";
import type { CrawlerRegistration } from "../registration";

const R18_BASE_URL = "https://r18.dev";
const MAX_GENERATED_GALLERY_IMAGES = 100;

type JsonRecord = Record<string, unknown>;
type EntityValue = JsonRecord | string;

const VIDEO_MARKER_KEYS = ["content_id", "dvd_id", "title_ja", "title_en", "runtime_mins", "jacket_full_url"] as const;

const WRAPPER_KEYS = ["data", "result", "payload", "video", "movie", "work", "item", "record"] as const;
const COLLECTION_KEYS = ["videos", "movies", "results", "items", "matches", "records"] as const;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : undefined;
};

const readString = (record: JsonRecord, keys: readonly string[]): string | undefined => {
  for (const key of keys) {
    const value = toNonEmptyString(record[key]);
    if (value) {
      return value;
    }
  }

  return undefined;
};

const readNumber = (record: JsonRecord, keys: readonly string[]): number | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
};

const canonicalR18Code = (value: string | undefined): string => {
  if (!value) {
    return "";
  }

  return value
    .trim()
    .replace(/[^a-z0-9]/giu, "")
    .toUpperCase()
    .replace(/^([A-Z]+)0+(\d+)$/u, "$1$2");
};

const looksLikeVideoRecord = (record: JsonRecord): boolean => VIDEO_MARKER_KEYS.some((key) => key in record);

const collectVideoRecords = (value: unknown, depth = 0): JsonRecord[] => {
  if (depth > 5) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectVideoRecords(entry, depth + 1));
  }

  if (!isRecord(value)) {
    return [];
  }

  if (looksLikeVideoRecord(value)) {
    return [value];
  }

  const records: JsonRecord[] = [];
  for (const key of COLLECTION_KEYS) {
    if (key in value) {
      records.push(...collectVideoRecords(value[key], depth + 1));
    }
  }
  for (const key of WRAPPER_KEYS) {
    if (key in value) {
      records.push(...collectVideoRecords(value[key], depth + 1));
    }
  }

  return records;
};

const recordMatchesCode = (record: JsonRecord, expectedCode: string): boolean => {
  const expected = canonicalR18Code(expectedCode);
  if (!expected) {
    return true;
  }

  const candidates = [
    readString(record, ["dvd_id", "dvdId", "product_id", "productId"]),
    readString(record, ["content_id", "contentId"]),
  ];

  return candidates.some((candidate) => canonicalR18Code(candidate) === expected);
};

const selectBestRecord = (payload: unknown, expectedCode: string): JsonRecord | null => {
  const records = collectVideoRecords(payload);
  if (records.length === 0) {
    return null;
  }

  return records.find((record) => recordMatchesCode(record, expectedCode)) ?? records[0] ?? null;
};

const buildCompactLookupCode = (number: string): string | null => {
  const matched = number.trim().match(/^([a-z]+)[\s_-]*(\d+)$/iu);
  if (!matched) {
    return null;
  }

  return `${matched[1].toLowerCase()}${matched[2].padStart(5, "0")}`;
};

const buildLookupCodes = (number: string): string[] => {
  const values = [number.trim(), buildCompactLookupCode(number)].filter((value): value is string =>
    Boolean(value?.trim()),
  );
  return Array.from(new Set(values));
};

const buildDvdLookupUrl = (code: string): string =>
  `${R18_BASE_URL}/videos/vod/movies/detail/-/dvd_id=${encodeURIComponent(code)}/json`;

const buildCombinedUrl = (contentId: string): string =>
  `${R18_BASE_URL}/videos/vod/movies/detail/-/combined=${encodeURIComponent(contentId)}/json`;

const pickLocalizedValue = (
  record: JsonRecord,
  language: R18MetadataLanguage,
  keys: {
    ja: readonly string[];
    en: readonly string[];
    neutral?: readonly string[];
  },
): string | undefined => {
  const orderedKeys =
    language === "ja"
      ? [...keys.ja, ...(keys.neutral ?? []), ...keys.en]
      : [...keys.en, ...(keys.neutral ?? []), ...keys.ja];

  return readString(record, orderedKeys);
};

const asEntityValues = (value: unknown): EntityValue[] => {
  if (Array.isArray(value)) {
    return value.flatMap(asEntityValues);
  }

  if (typeof value === "string" || isRecord(value)) {
    return [value];
  }

  return [];
};

const findNestedEntityRecord = (record: JsonRecord): JsonRecord | undefined => {
  for (const key of ["actress", "actor", "performer", "director", "category", "maker", "label", "series"]) {
    const value = record[key];
    if (isRecord(value)) {
      return value;
    }
  }

  return undefined;
};

const pickPersonName = (entity: JsonRecord, language: R18MetadataLanguage): string | undefined =>
  pickLocalizedValue(entity, language, {
    ja: ["name_ja", "nameJa", "name_kanji", "nameKanji", "name_kana", "nameKana"],
    en: ["name_en", "nameEn", "name_romaji", "nameRomaji"],
    neutral: ["name"],
  });

const pickNamedEntity = (entity: EntityValue, language: R18MetadataLanguage): string | undefined => {
  if (typeof entity === "string") {
    return toNonEmptyString(entity);
  }

  const nested = findNestedEntityRecord(entity);
  return (
    pickLocalizedValue(entity, language, {
      ja: ["name_ja", "nameJa", "name_kanji", "nameKanji", "name_kana", "nameKana"],
      en: ["name_en", "nameEn", "name_romaji", "nameRomaji"],
      neutral: ["name"],
    }) ?? (nested ? pickPersonName(nested, language) : undefined)
  );
};

const readEntityNames = (record: JsonRecord, keys: readonly string[], language: R18MetadataLanguage): string[] => {
  const values = keys.flatMap((key) => asEntityValues(record[key]));
  return uniqueStrings(values.map((value) => pickNamedEntity(value, language)));
};

const readRelationName = (
  record: JsonRecord,
  relation: "maker" | "label" | "series",
  language: R18MetadataLanguage,
): string | undefined => {
  const capitalizedRelation = `${relation[0].toUpperCase()}${relation.slice(1)}`;
  const direct = pickLocalizedValue(record, language, {
    ja: [`${relation}_name_ja`, `${relation}NameJa`, `${relation}_ja`, `${relation}Ja`],
    en: [`${relation}_name_en`, `${relation}NameEn`, `${relation}_en`, `${relation}En`],
    neutral: [`${relation}_name`, `${relation}Name`],
  });
  if (direct) {
    return direct;
  }

  const nested = record[relation] ?? record[capitalizedRelation];
  return asEntityValues(nested)
    .map((value) => pickNamedEntity(value, language))
    .find((value): value is string => Boolean(value));
};

const readStringArray = (record: JsonRecord, keys: readonly string[]): string[] => {
  const values: Array<string | undefined> = [];

  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" || typeof item === "number") {
          values.push(toNonEmptyString(item));
        } else if (isRecord(item)) {
          values.push(readString(item, ["url", "full_url", "fullUrl", "full", "large", "image_url", "imageUrl"]));
        }
      }
      continue;
    }

    values.push(toNonEmptyString(value));
  }

  return uniqueStrings(values);
};

const enumerateUrlRange = (first: string | undefined, last: string | undefined): string[] => {
  if (!first || !last || first === last) {
    return uniqueStrings([first, last]);
  }

  const firstMatch = first.match(/^(.*?)(\d+)(\.[a-z][a-z0-9]*(?:[?#].*)?)$/iu);
  const lastMatch = last.match(/^(.*?)(\d+)(\.[a-z][a-z0-9]*(?:[?#].*)?)$/iu);
  if (!firstMatch || !lastMatch || firstMatch[1] !== lastMatch[1] || firstMatch[3] !== lastMatch[3]) {
    return uniqueStrings([first, last]);
  }

  const start = Number.parseInt(firstMatch[2], 10);
  const end = Number.parseInt(lastMatch[2], 10);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return uniqueStrings([first, last]);
  }

  const count = end - start + 1;
  if (count > MAX_GENERATED_GALLERY_IMAGES) {
    return uniqueStrings([first, last]);
  }

  const width = firstMatch[2].length;
  return Array.from(
    { length: count },
    (_, index) => `${firstMatch[1]}${String(start + index).padStart(width, "0")}${firstMatch[3]}`,
  );
};

const readSceneImages = (record: JsonRecord): string[] => {
  const direct = readStringArray(record, [
    "gallery_full_urls",
    "galleryFullUrls",
    "gallery_urls",
    "galleryUrls",
    "sample_image_urls",
    "sampleImageUrls",
    "scene_images",
    "sceneImages",
    "images",
  ]);
  const ranged = enumerateUrlRange(
    readString(record, ["gallery_full_first", "galleryFullFirst"]),
    readString(record, ["gallery_full_last", "galleryFullLast"]),
  );

  return uniqueStrings([...direct, ...ranged]);
};

const readDurationSeconds = (record: JsonRecord): number | undefined => {
  const minutes = readNumber(record, ["runtime_mins", "runtimeMins", "runtime_minutes", "duration_mins"]);
  if (minutes !== undefined) {
    return Math.max(0, Math.trunc(minutes * 60));
  }

  const seconds = readNumber(record, ["duration_seconds", "durationSeconds"]);
  return seconds === undefined ? undefined : Math.max(0, Math.trunc(seconds));
};

const mapR18RecordToCrawlerData = (
  record: JsonRecord,
  inputNumber: string,
  language: R18MetadataLanguage,
): CrawlerData | null => {
  const title = pickLocalizedValue(record, language, {
    ja: ["title_ja", "titleJa", "title_japanese", "titleJapanese"],
    en: ["title_en", "titleEn", "title_english", "titleEnglish"],
    neutral: ["title"],
  });
  if (!title) {
    return null;
  }

  const number = readString(record, ["dvd_id", "dvdId", "product_id", "productId"]) ?? inputNumber;
  const actressNames = readEntityNames(record, ["actresses", "actress", "female_performers"], language);
  const actorNames = readEntityNames(record, ["actors", "actor", "performers", "casts"], language);
  const genres = readEntityNames(record, ["categories", "category", "genres", "genre"], language);
  const directors = readEntityNames(record, ["directors", "director"], language);
  const thumbUrl = readString(record, ["jacket_full_url", "jacketFullUrl", "image_url", "imageUrl"]);
  const posterUrl = readString(record, ["jacket_thumb_url", "jacketThumbUrl", "thumbnail_url", "thumbnailUrl"]);
  const trailerUrl = readString(record, ["sample_url", "sampleUrl", "trailer_url", "trailerUrl"]);

  return {
    title,
    number,
    actors: uniqueStrings([...actressNames, ...actorNames]),
    genres,
    studio: readRelationName(record, "maker", language),
    director: directors[0],
    publisher: readRelationName(record, "label", language),
    series: readRelationName(record, "series", language),
    plot: pickLocalizedValue(record, language, {
      ja: ["comment_ja", "commentJa", "description_ja", "descriptionJa"],
      en: ["comment_en", "commentEn", "description_en", "descriptionEn"],
      neutral: ["comment", "description", "plot"],
    }),
    release_date: parseDate(readString(record, ["release_date", "releaseDate", "date"])),
    durationSeconds: readDurationSeconds(record),
    thumb_url: thumbUrl,
    poster_url: posterUrl,
    fanart_url: thumbUrl,
    thumb_source_url: thumbUrl,
    poster_source_url: posterUrl,
    fanart_source_url: thumbUrl,
    scene_images: readSceneImages(record),
    trailer_url: trailerUrl,
    trailer_source_url: trailerUrl,
    website: Website.R18_DEV,
  };
};

const toFailureReason = (message: string): FailureReason => {
  const lowered = message.toLowerCase();
  if (
    lowered.includes("timeout") ||
    lowered.includes("timed out") ||
    lowered.includes("etimedout") ||
    lowered.includes("abort")
  ) {
    return "timeout";
  }

  if (lowered.includes("404") || lowered.includes("not found")) {
    return "not_found";
  }

  if (lowered.includes("parse") || lowered.includes("metadata") || lowered.includes("malformed")) {
    return "parse_error";
  }

  return "unknown";
};

const isNotFoundError = (error: unknown): boolean => toFailureReason(toErrorMessage(error)) === "not_found";

export class R18DevCrawler implements SiteAdapter {
  private readonly gateway: FetchGateway;

  constructor(dependencies: AdapterDependencies) {
    this.gateway = dependencies.gateway;
  }

  site(): Website {
    return Website.R18_DEV;
  }

  async crawl(input: CrawlerInput): Promise<CrawlerResponse> {
    const startedAt = Date.now();
    const result = await this.crawlInternal(input);

    return {
      input,
      result,
      elapsedMs: Date.now() - startedAt,
    };
  }

  private async crawlInternal(input: CrawlerInput): Promise<CrawlerResult> {
    try {
      const language = input.options?.r18MetadataLanguage ?? DEFAULT_R18_METADATA_LANGUAGE;
      const lookupRecord = await this.fetchLookupRecord(input);
      if (!lookupRecord) {
        return {
          success: false,
          error: `R18.dev detail URL not found for ${input.number}`,
          failureReason: "not_found",
        };
      }

      const contentId = readString(lookupRecord, ["content_id", "contentId"]);
      const detailRecord = contentId
        ? ((await this.fetchCombinedRecord(contentId, input)) ?? lookupRecord)
        : lookupRecord;
      const data = mapR18RecordToCrawlerData(detailRecord, input.number, language);
      if (!data) {
        return {
          success: false,
          error: `R18.dev metadata parsing failed for ${input.number}`,
          failureReason: "parse_error",
        };
      }

      return {
        success: true,
        data,
      };
    } catch (error) {
      const message = toErrorMessage(error);
      return {
        success: false,
        error: message,
        failureReason: toFailureReason(message),
        cause: error,
      };
    }
  }

  private async fetchLookupRecord(input: CrawlerInput): Promise<JsonRecord | null> {
    for (const code of buildLookupCodes(input.number)) {
      try {
        const payload = await this.gateway.fetchJson<unknown>(buildDvdLookupUrl(code), {
          timeout: input.options?.timeoutMs,
          signal: input.options?.signal,
          headers: {
            accept: "application/json",
          },
        });
        const record = selectBestRecord(payload, input.number);
        if (record) {
          return record;
        }
      } catch (error) {
        if (!isNotFoundError(error)) {
          throw error;
        }
      }
    }

    return null;
  }

  private async fetchCombinedRecord(contentId: string, input: CrawlerInput): Promise<JsonRecord | null> {
    try {
      const payload = await this.gateway.fetchJson<unknown>(buildCombinedUrl(contentId), {
        timeout: input.options?.timeoutMs,
        signal: input.options?.signal,
        headers: {
          accept: "application/json",
        },
      });
      return selectBestRecord(payload, contentId);
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }
}

export const crawlerRegistration: CrawlerRegistration = {
  site: Website.R18_DEV,
  crawler: R18DevCrawler,
};

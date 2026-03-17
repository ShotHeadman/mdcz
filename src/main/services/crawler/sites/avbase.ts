import { normalizeCode, normalizeText } from "@main/utils/normalization";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import type { CheerioAPI } from "cheerio";

import { BaseCrawler } from "../base/BaseCrawler";
import { parseDate } from "../base/parser";
import type { Context } from "../base/types";
import { uniqueStrings } from "./helpers";

const AVBASE_BASE_URL = "https://www.avbase.net";

interface AvbaseNextData {
  props?: {
    pageProps?: {
      works?: AvbaseSearchWork[];
      work?: AvbaseWork | null;
    };
  };
}

interface AvbasePerson {
  name?: string | null;
}

interface AvbaseCastEntry {
  actor?: AvbasePerson | null;
}

interface AvbaseGenre {
  name?: string | null;
}

interface AvbaseProductRelation {
  name?: string | null;
}

interface AvbaseSampleImage {
  l?: string | null;
}

interface AvbaseItemInfo {
  description?: string | null;
  director?: string | null;
  volume?: string | null;
}

interface AvbaseProduct {
  image_url?: string | null;
  iteminfo?: AvbaseItemInfo | null;
  label?: AvbaseProductRelation | null;
  maker?: AvbaseProductRelation | null;
  sample_image_urls?: AvbaseSampleImage[] | null;
  series?: AvbaseProductRelation | null;
  thumbnail_url?: string | null;
}

interface AvbaseSearchActor {
  name?: string | null;
}

interface AvbaseSearchWork {
  min_date?: string | null;
  prefix?: string | null;
  products?: AvbaseProduct[] | null;
  title?: string | null;
  work_id?: string | null;
  actors?: AvbaseSearchActor[] | null;
}

interface AvbaseWork {
  actors?: AvbaseSearchActor[] | null;
  casts?: AvbaseCastEntry[] | null;
  genres?: AvbaseGenre[] | null;
  min_date?: string | null;
  prefix?: string | null;
  products?: AvbaseProduct[] | null;
  title?: string | null;
  work_id?: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : undefined;
};

const escapeRegExp = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
};

const parseMinutesToSeconds = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const match = value.match(/(\d{1,4})/u);
  if (!match) {
    return undefined;
  }

  const minutes = Number.parseInt(match[1], 10);
  return Number.isFinite(minutes) ? minutes * 60 : undefined;
};

const formatDatePart = (value: number): string => {
  return String(value).padStart(2, "0");
};

const parseAvbaseDate = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getUTCFullYear()}-${formatDatePart(parsed.getUTCMonth() + 1)}-${formatDatePart(parsed.getUTCDate())}`;
  }

  return parseDate(value) ?? undefined;
};

const buildDetailUrl = (baseUrl: string, prefix: string | undefined, workId: string): string => {
  const normalizedPrefix = toNonEmptyString(prefix);
  const encodedWorkId = encodeURIComponent(workId);
  return normalizedPrefix
    ? `${baseUrl}/works/${encodeURIComponent(normalizedPrefix)}:${encodedWorkId}`
    : `${baseUrl}/works/${encodedWorkId}`;
};

const stripTrailingActorsFromTitle = (title: string, actors: string[]): string => {
  if (actors.length === 0) {
    return title;
  }

  const actorPattern = actors
    .map((actor) => escapeRegExp(actor))
    .sort((left, right) => right.length - left.length)
    .join("|");

  if (!actorPattern) {
    return title;
  }

  const actorListPattern = `(?:${actorPattern})(?:\\s*[、,/&＆]\\s*(?:${actorPattern}))*`;
  const stripped = title
    .replace(new RegExp(`\\s*[（(]\\s*${actorListPattern}\\s*[）)]\\s*$`, "u"), "")
    .replace(new RegExp(`\\s+${actorListPattern}\\s*$`, "u"), "")
    .trim();

  return stripped || title;
};

const pickFirstNonEmpty = (
  products: AvbaseProduct[],
  selector: (product: AvbaseProduct) => string | undefined,
): string | undefined => {
  for (const product of products) {
    const value = selector(product);
    if (value) {
      return value;
    }
  }

  return undefined;
};

const productSampleCount = (product: AvbaseProduct): number => {
  return product.sample_image_urls?.length ?? 0;
};

const productMetadataScore = (product: AvbaseProduct): number => {
  let score = 0;

  if (toNonEmptyString(product.maker?.name)) score += 1;
  if (toNonEmptyString(product.label?.name)) score += 1;
  if (toNonEmptyString(product.series?.name)) score += 1;
  if (toNonEmptyString(product.iteminfo?.director)) score += 1;
  if (toNonEmptyString(product.iteminfo?.description)) score += 1;
  if (toNonEmptyString(product.iteminfo?.volume)) score += 1;
  if (toNonEmptyString(product.image_url)) score += 1;
  if (toNonEmptyString(product.thumbnail_url)) score += 1;

  return score;
};

const workScore = (work: AvbaseSearchWork): [number, number, number, number] => {
  const products = work.products ?? [];
  const metadataScore = products.reduce((total, product) => total + productMetadataScore(product), 0);
  const sampleCount = Math.max(...products.map((product) => productSampleCount(product)), 0);
  const timestamp = new Date(work.min_date ?? "").getTime();
  return [
    products.length,
    metadataScore,
    sampleCount,
    Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY,
  ];
};

const compareScores = (left: [number, number, number, number], right: [number, number, number, number]): number => {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }

  return 0;
};

type AvbasePageProps = NonNullable<NonNullable<AvbaseNextData["props"]>["pageProps"]>;

const ACTOR_BLOCK_LABELS = ["出演者・メモ", "出演者"] as const;

const ownText = ($: CheerioAPI, element: Parameters<CheerioAPI>[0]): string => {
  const clone = $(element).clone();
  clone.children().remove();
  return normalizeText(clone.text());
};

const extractActorNamesFromScope = ($: CheerioAPI, scope: Parameters<CheerioAPI>[0]): string[] => {
  return uniqueStrings(
    $(scope)
      .find("a[href*='/talents/'] span")
      .toArray()
      .map((element) => toNonEmptyString($(element).text())),
  );
};

const readDomActors = ($: CheerioAPI): string[] => {
  for (const element of $("body *").toArray()) {
    const text = ownText($, element);
    if (!ACTOR_BLOCK_LABELS.some((label) => text.includes(label))) {
      continue;
    }

    const parent = $(element).parent();
    for (const scope of [parent, parent.next(), parent.parent()]) {
      const actorNames = extractActorNamesFromScope($, scope);
      if (actorNames.length > 0) {
        return actorNames;
      }
    }
  }

  return [];
};

const readPageProps = ($: CheerioAPI): AvbasePageProps | undefined => {
  const raw = $("script#__NEXT_DATA__").first().text().trim();
  if (!raw) {
    throw new Error("AVBase parse error: __NEXT_DATA__ missing");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AVBase parse error: invalid __NEXT_DATA__ JSON");
  }

  if (!isRecord(parsed)) {
    throw new Error("AVBase parse error: unexpected __NEXT_DATA__ shape");
  }

  return (parsed as AvbaseNextData).props?.pageProps;
};

export class AvbaseCrawler extends BaseCrawler {
  site(): Website {
    return Website.AVBASE;
  }

  protected async generateSearchUrl(context: Context): Promise<string | null> {
    const number = normalizeText(context.number);
    if (!number) {
      return null;
    }

    const baseUrl = this.resolveBaseUrl(context, AVBASE_BASE_URL);
    return `${baseUrl}/works?q=${encodeURIComponent(number)}`;
  }

  protected async parseSearchPage(context: Context, $: CheerioAPI, _searchUrl: string): Promise<string | null> {
    const pageProps = readPageProps($);
    const works = pageProps?.works ?? [];
    const expected = normalizeCode(context.number);

    const candidates = works.filter((work) => normalizeCode(work.work_id) === expected);
    if (candidates.length === 0) {
      return null;
    }

    const best = candidates.reduce(
      (winner, current) => {
        if (!winner) {
          return current;
        }

        return compareScores(workScore(current), workScore(winner)) > 0 ? current : winner;
      },
      candidates[0] as AvbaseSearchWork | undefined,
    );

    const workId = toNonEmptyString(best?.work_id);
    if (!workId) {
      return null;
    }

    const baseUrl = this.resolveBaseUrl(context, AVBASE_BASE_URL);
    return buildDetailUrl(baseUrl, best?.prefix ?? undefined, workId);
  }

  protected async parseDetailPage(context: Context, $: CheerioAPI): Promise<CrawlerData | null> {
    const pageProps = readPageProps($);
    const work = pageProps?.work;
    const number = toNonEmptyString(work?.work_id) ?? normalizeText(context.number);
    const rawTitle = toNonEmptyString(work?.title);
    if (!number || !rawTitle) {
      return null;
    }

    const domActors = readDomActors($);
    const castActors = uniqueStrings((work?.casts ?? []).map((entry) => toNonEmptyString(entry.actor?.name)));
    const actors =
      domActors.length > 0
        ? domActors
        : castActors.length > 0
          ? castActors
          : uniqueStrings((work?.actors ?? []).map((actor) => toNonEmptyString(actor.name)));
    const genres = uniqueStrings((work?.genres ?? []).map((genre) => toNonEmptyString(genre.name)));
    const title = stripTrailingActorsFromTitle(rawTitle, actors);
    const products = work?.products ?? [];

    const sampleProduct = [...products].sort((left, right) => {
      const sampleDifference = productSampleCount(right) - productSampleCount(left);
      if (sampleDifference !== 0) {
        return sampleDifference;
      }

      return productMetadataScore(right) - productMetadataScore(left);
    })[0];

    const sampleImages = (sampleProduct?.sample_image_urls ?? [])
      .map((image) => toNonEmptyString(image.l))
      .filter((image): image is string => Boolean(image));

    return {
      title,
      number,
      actors,
      genres,
      studio: pickFirstNonEmpty(products, (product) => toNonEmptyString(product.maker?.name)),
      director: pickFirstNonEmpty(products, (product) => toNonEmptyString(product.iteminfo?.director)),
      publisher: pickFirstNonEmpty(products, (product) => toNonEmptyString(product.label?.name)),
      series: pickFirstNonEmpty(products, (product) => toNonEmptyString(product.series?.name)),
      plot: pickFirstNonEmpty(products, (product) => toNonEmptyString(product.iteminfo?.description)),
      release_date: parseAvbaseDate(work?.min_date ?? undefined),
      durationSeconds: parseMinutesToSeconds(
        pickFirstNonEmpty(products, (product) => toNonEmptyString(product.iteminfo?.volume)),
      ),
      thumb_url: pickFirstNonEmpty(products, (product) => toNonEmptyString(product.image_url)),
      poster_url: pickFirstNonEmpty(products, (product) => toNonEmptyString(product.thumbnail_url)),
      sample_images: sampleImages,
      website: Website.AVBASE,
    };
  }
}

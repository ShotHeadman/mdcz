import { normalizeActorName, toUniqueActorNames } from "@main/utils/actor";
import { normalizeText } from "@main/utils/normalization";
import { type CheerioAPI, load } from "cheerio";
import type { ActorSourceHint } from "../../types";

export interface OfficialActressSummary {
  name: string;
  aliases: string[];
  url?: string;
  photoUrl?: string;
}

export const OFFICIAL_HEADERS = {
  "accept-language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
};
export const MGSTAGE_HEADERS = {
  ...OFFICIAL_HEADERS,
  cookie: "adc=1; coc=1",
};
export const ROSTER_CACHE_TTL_MS = 30 * 60 * 1000;

export const createCacheBucket = (ttlMs = ROSTER_CACHE_TTL_MS): string => {
  return String(Math.floor(Date.now() / ttlMs));
};

export const toNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = normalizeText(value);
  return normalized || undefined;
};

export const toUniqueNames = (values: Array<string | undefined>): string[] => {
  return toUniqueActorNames(values, toNonEmptyString);
};

export const toAbsoluteUrl = (baseUrl: string, value: string | undefined): string | undefined => {
  const normalized = toNonEmptyString(value);
  if (!normalized) {
    return undefined;
  }

  if (/^https?:\/\//iu.test(normalized)) {
    return normalized;
  }
  if (normalized.startsWith("//")) {
    return `https:${normalized}`;
  }

  return new URL(normalized, baseUrl).toString();
};

type CheerioSelection = ReturnType<CheerioAPI>;

export const getOwnText = ($element: CheerioSelection): string | undefined => {
  if ($element.length === 0) {
    return undefined;
  }

  const clone = $element.clone();
  clone.children().remove();
  return toNonEmptyString(clone.text());
};

export const buildFieldDescription = (
  fields: Array<[string, string | undefined]>,
  intro?: string,
): string | undefined => {
  const lines: string[] = [];
  const body = toNonEmptyString(intro);
  if (body) {
    lines.push(body);
  }

  for (const [label, value] of fields) {
    const normalizedLabel = toNonEmptyString(label);
    const normalizedValue = toNonEmptyString(value);
    if (!normalizedLabel || !normalizedValue) {
      continue;
    }
    lines.push(`${normalizedLabel}: ${normalizedValue}`);
  }

  return lines.length > 0 ? lines.join("\n") : undefined;
};

export const parseDefinitionList = ($root: CheerioSelection): Array<[string, string | undefined]> => {
  const fields: Array<[string, string | undefined]> = [];
  const labels = $root.find("dt").toArray();

  for (const labelElement of labels) {
    const labelNode = $root.find(labelElement).first();
    const valueNode = labelNode.next("dd");
    const label = toNonEmptyString(labelNode.text());
    if (!label) {
      continue;
    }
    fields.push([label, toNonEmptyString(valueNode.text())]);
  }

  return fields;
};

export const parseActressProfileFields = ($: CheerioAPI): Array<[string, string | undefined]> => {
  return $(".box_actress02_list li")
    .toArray()
    .map((element) => {
      const item = $(element);
      return [
        toNonEmptyString(item.find("span").first().text()) ?? "",
        toNonEmptyString(item.find("p").first().text()),
      ] as [string, string | undefined];
    })
    .filter(([label, value]) => Boolean(label) && Boolean(value));
};

export const hasMatchingName = (queryNames: string[], names: Array<string | undefined>): boolean => {
  const candidates = toUniqueNames(names);
  return candidates.some((candidate) =>
    queryNames.some((queryName) => normalizeActorName(candidate) === normalizeActorName(queryName)),
  );
};

export const formatIsoDate = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  return value.slice(0, 10);
};

export const matchesSourceHost = (hint: ActorSourceHint, host: string): boolean => {
  const value = toNonEmptyString(hint.sourceUrl);
  if (!value) {
    return false;
  }

  try {
    return new URL(value).hostname.includes(host);
  } catch {
    return false;
  }
};

export const extractBackgroundImageUrl = (baseUrl: string, style: string | undefined): string | undefined => {
  const matched = style?.match(/background-image:\s*url\((['"]?)(.*?)\1\)/iu);
  return toAbsoluteUrl(baseUrl, matched?.[2]);
};

export const extractTextWithBreaks = (html: string | undefined): string | undefined => {
  if (!html) {
    return undefined;
  }

  const rendered = html.replace(/<br\s*\/?>/giu, "\n").replace(/<\/p>/giu, "\n");
  const $ = load(`<div>${rendered}</div>`);
  const lines = $("div")
    .text()
    .split(/\n+/u)
    .map((line) => normalizeText(line))
    .filter((line) => line.length > 0);

  return lines.length > 0 ? lines.join("\n") : undefined;
};

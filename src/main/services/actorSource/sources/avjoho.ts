import type { Configuration } from "@main/services/config";
import type { NetworkClient } from "@main/services/network";
import { normalizeActorName, toUniqueActorNames } from "@main/utils/actor";
import {
  parseActorBloodType,
  parseActorDate,
  parseActorMeasurements,
  parseActorMetricCm,
} from "@main/utils/actorProfile";
import { buildUrl } from "@main/utils/common";
import { normalizeText } from "@main/utils/normalization";
import { load } from "cheerio";
import { mergeActorSourceHints } from "../sourceHints";
import type { ActorLookupQuery, ActorSourceResult, BaseActorSource } from "../types";

const DEFAULT_AVJOHO_BASE_URL = "https://db.avjoho.com";
const DEFAULT_AVJOHO_HEADERS = {
  "accept-language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
};
const EMPTY_FIELD_PATTERN = /^[-–—―ー]+$/u;
const PROFILE_FIELD_ORDER = ["デビュー", "趣味・特技", "専属メーカー", "X"] as const;
const AGENCY_FIELD_NAMES = ["所属事務所", "所属プロダクション", "所属", "事務所"] as const;

export interface AvjohoActorSourceDependencies {
  networkClient: NetworkClient;
  baseUrl?: string;
}

interface ParsedActorTitle {
  displayName: string;
  primaryName: string;
  aliases: string[];
}

const parseActorTitle = (value: string): ParsedActorTitle => {
  const displayName = normalizeText(value);
  const matched = displayName.match(/^(.*?)[(（]([^()（）]+)[)）]$/u);
  if (!matched) {
    return {
      displayName,
      primaryName: displayName,
      aliases: [],
    };
  }

  const primaryName = normalizeText(matched[1]);
  const alias = normalizeText(matched[2]);
  return {
    displayName,
    primaryName: primaryName || displayName,
    aliases: alias ? [alias] : [],
  };
};

const splitAliases = (value: string): string[] => {
  if (!value || EMPTY_FIELD_PATTERN.test(value)) {
    return [];
  }

  return toUniqueActorNames(value.split(/[、,/／]/u), normalizeText);
};

const resolveUrl = (baseUrl: string, value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  return new URL(normalized, baseUrl).toString();
};

interface HtmlLoadResult {
  html: string;
  warnings: string[];
}

const isChallengePage = (html: string): boolean => {
  return (
    html.includes("少々お待ちください") &&
    (html.includes("リクエストが確認されるまでお待ちください") || html.includes("wsidchk"))
  );
};

const getHtml = async (
  networkClient: NetworkClient,
  url: string,
  headers: Record<string, string> = {},
): Promise<HtmlLoadResult> => {
  const html = await networkClient.getText(url, {
    headers: {
      ...DEFAULT_AVJOHO_HEADERS,
      ...headers,
    },
  });

  if (!isChallengePage(html)) {
    return {
      html,
      warnings: [],
    };
  }

  return {
    html,
    warnings: [`AVJOHO returned a browser challenge page for ${url}`],
  };
};

const readProfileFields = (html: string): Map<string, string> => {
  const $ = load(html);
  const fields = new Map<string, string>();

  $("article .entry-content table tr").each((_, row) => {
    const label = normalizeText($(row).find("th").first().text());
    const value = normalizeText($(row).find("td").first().text());
    if (!label || !value || EMPTY_FIELD_PATTERN.test(value)) {
      return;
    }

    fields.set(label, value);
  });

  return fields;
};

const buildDescription = (_displayName: string, fields: Map<string, string>): string | undefined => {
  const lines: string[] = [];

  for (const label of PROFILE_FIELD_ORDER) {
    const value = fields.get(label);
    if (!value) {
      continue;
    }
    lines.push(`${label}: ${value}`);
  }

  return lines.length > 0 ? lines.join("\n\n") : undefined;
};

const pickFieldValue = (fields: Map<string, string>, labels: readonly string[]): string | undefined => {
  for (const label of labels) {
    const value = fields.get(label);
    if (value) {
      return value;
    }
  }

  return undefined;
};

const matchesSearchCandidate = (candidate: ParsedActorTitle, queryName: string): boolean => {
  const normalizedQuery = normalizeActorName(queryName);
  if (!normalizedQuery) {
    return false;
  }

  return [candidate.displayName, candidate.primaryName, ...candidate.aliases].some(
    (value) => normalizeActorName(value) === normalizedQuery,
  );
};

const findDetailUrl = async (
  networkClient: NetworkClient,
  baseUrl: string,
  queryName: string,
): Promise<{ detailUrl?: string; warnings: string[] }> => {
  const { html, warnings } = await getHtml(networkClient, buildUrl(baseUrl, "/", { s: queryName }));
  const $ = load(html);
  let detailUrl: string | undefined;

  $("article.article-list h1.entry-title a").each((_, link) => {
    if (detailUrl) {
      return;
    }

    const title = normalizeText($(link).text());
    const href = $(link).attr("href");
    if (!title || !href) {
      return;
    }

    if (matchesSearchCandidate(parseActorTitle(title), queryName)) {
      detailUrl = resolveUrl(baseUrl, href);
    }
  });

  return {
    detailUrl,
    warnings,
  };
};

const parseDetailProfile = (baseUrl: string, html: string) => {
  const $ = load(html);
  const title =
    normalizeText($("article h1.entry-title").first().text()) ||
    normalizeText($("meta[property='og:title']").attr("content"));
  if (!title) {
    return null;
  }

  const parsedTitle = parseActorTitle(title);
  const fields = readProfileFields(html);
  const aliases = toUniqueActorNames(
    [...parsedTitle.aliases, ...splitAliases(fields.get("別名") ?? "")],
    normalizeText,
  );
  const measurements = parseActorMeasurements(fields.get("スリーサイズ"));

  return {
    name: parsedTitle.primaryName,
    aliases: aliases.length > 0 ? aliases : undefined,
    birth_date: parseActorDate(fields.get("生年月日")),
    birth_place: fields.get("出身地"),
    blood_type: parseActorBloodType(fields.get("血液型")),
    description: buildDescription(parsedTitle.displayName, fields),
    height_cm: parseActorMetricCm(fields.get("身長")),
    bust_cm: measurements.bust_cm,
    waist_cm: measurements.waist_cm,
    hip_cm: measurements.hip_cm,
    cup_size: fields.get("カップ") ?? measurements.cup_size,
    photo_url:
      resolveUrl(baseUrl, $("meta[property='og:image']").attr("content")) ??
      resolveUrl(baseUrl, $(".gazou img").attr("src")),
    sourceHints: mergeActorSourceHints([
      {
        agency: pickFieldValue(fields, AGENCY_FIELD_NAMES),
        studio: fields.get("専属メーカー"),
      },
    ]),
  };
};

export class AvjohoActorSource implements BaseActorSource {
  readonly name = "avjoho" as const;

  private readonly baseUrl: string;

  constructor(private readonly deps: AvjohoActorSourceDependencies) {
    this.baseUrl = deps.baseUrl?.replace(/\/+$/u, "") ?? DEFAULT_AVJOHO_BASE_URL;

    if (typeof deps.networkClient.setDomainLimit === "function") {
      deps.networkClient.setDomainLimit(new URL(this.baseUrl).hostname, 1, 1);
    }
  }

  async lookup(_configuration: Configuration, query: ActorLookupQuery): Promise<ActorSourceResult> {
    try {
      const warnings: string[] = [];

      for (const searchName of toUniqueActorNames([query.name, ...(query.aliases ?? [])], normalizeText)) {
        const searchResult = await findDetailUrl(this.deps.networkClient, this.baseUrl, searchName);
        warnings.push(...searchResult.warnings);
        const detailUrl = searchResult.detailUrl;
        if (!detailUrl) {
          continue;
        }

        const detailResult = await getHtml(this.deps.networkClient, detailUrl);
        warnings.push(...detailResult.warnings);
        const detailHtml = detailResult.html;
        const profile = parseDetailProfile(this.baseUrl, detailHtml);
        if (!profile) {
          continue;
        }

        return {
          source: this.name,
          success: true,
          profile: {
            name: profile.name,
            aliases: profile.aliases,
            birth_date: profile.birth_date,
            birth_place: profile.birth_place,
            blood_type: profile.blood_type,
            description: profile.description,
            height_cm: profile.height_cm,
            bust_cm: profile.bust_cm,
            waist_cm: profile.waist_cm,
            hip_cm: profile.hip_cm,
            cup_size: profile.cup_size,
            photo_url: profile.photo_url,
          },
          warnings,
          sourceHints: profile.sourceHints,
        };
      }

      return {
        source: this.name,
        success: true,
        warnings,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        source: this.name,
        success: false,
        warnings: [`Failed to load AVJOHO actor data: ${message}`],
      };
    }
  }
}

import { normalizeKeyword, normalizeTokens, toTokenArray } from "./normalization";
import type { JsonMappingRoot, JsonMappingRow, MappingEntry } from "./types";

export const toInfoEntry = (row: JsonMappingRow): MappingEntry | null => {
  const rawKeywords = Array.isArray(row.keywords)
    ? row.keywords
    : typeof row.keywords === "string"
      ? row.keywords.split(",")
      : typeof row.keyword === "string"
        ? row.keyword.split(",")
        : [];

  const keywords = rawKeywords.map((item) => normalizeKeyword(item)).filter((item) => item.length > 0);
  if (keywords.length === 0) {
    return null;
  }

  return {
    zh_cn: row.zh_cn ?? "",
    zh_tw: row.zh_tw ?? "",
    jp: row.jp ?? "",
    keywords,
  };
};

export const toActorEntry = (row: JsonMappingRow): MappingEntry | null => {
  const canonical = (row.canonical ?? row.jp ?? row.zh_cn ?? row.zh_tw ?? "").trim();
  if (!canonical) {
    return null;
  }

  const rawAliases = [
    ...toTokenArray(row.aliases),
    ...toTokenArray(row.keywords),
    ...toTokenArray(row.keyword),
    canonical,
  ];

  const aliases = normalizeTokens(rawAliases);
  const keywords = aliases.map((alias) => normalizeKeyword(alias)).filter((alias) => alias.length > 0);
  if (keywords.length === 0) {
    return null;
  }

  return {
    zh_cn: canonical,
    zh_tw: canonical,
    jp: canonical,
    keywords,
  };
};

export const toJsonRows = (payload: unknown): JsonMappingRow[] => {
  if (Array.isArray(payload)) {
    return payload as JsonMappingRow[];
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const root = payload as JsonMappingRoot;
  if (Array.isArray(root.entries)) {
    return root.entries;
  }

  return [];
};

import { join } from "node:path";
import { convertToSimplified, convertToTraditional } from "@main/utils/language";
import { normalizeKeyword, normalizeTokens, toTokenArray } from "./normalization";
import {
  enqueueCandidateWrite,
  loadCandidateCounts as loadCandidateCountsFromDisk,
  loadJsonMappings,
  loadOptionalJsonMappings,
  loadUserMappingDocument,
  MAPPING_CANDIDATE_FILE,
  resolveCandidateDirectory,
  resolveMappingDirectory,
  resolveUserMappingFilePath,
  saveUserMappingDocument,
} from "./storage";
import type {
  CandidateLanguageTarget,
  JsonMappingRow,
  LanguageTarget,
  MappingCandidateCategory,
  MappingCandidateRecord,
  MappingEntry,
} from "./types";

// Re-export types for consumers
export type { CandidateLanguageTarget, LanguageTarget, MappingCandidateCategory } from "./types";

// ── Mutable state ──────────────────────────────────────────────────────

let loaded = false;
let actorIndex = new Map<string, MappingEntry>();
let infoIndex = new Map<string, MappingEntry>();
let candidateWriteQueue: Promise<void> = Promise.resolve();
let candidatePromotionQueue: Promise<void> = Promise.resolve();
let candidateCountLoaded = false;

const candidateCountIndex: Record<MappingCandidateCategory, Map<string, number>> = {
  actor: new Map<string, number>(),
  genre: new Map<string, number>(),
};

const AUTO_PROMOTE_THRESHOLD = 3;

// ── Internal helpers ───────────────────────────────────────────────────

const buildKeywordIndex = (entries: MappingEntry[]): Map<string, MappingEntry> => {
  const index = new Map<string, MappingEntry>();

  for (const entry of entries) {
    for (const keyword of entry.keywords) {
      if (!index.has(keyword)) {
        index.set(keyword, entry);
      }
    }
  }

  return index;
};

const buildCandidateCountKey = (
  normalizedKeyword: string,
  target: CandidateLanguageTarget | string,
  mapped: string,
): string => {
  return `${normalizedKeyword}\0${target}\0${mapped}`;
};

const getIndexByCategory = (category: MappingCandidateCategory): Map<string, MappingEntry> => {
  return category === "actor" ? actorIndex : infoIndex;
};

const pickLanguageValue = (entry: MappingEntry, language: LanguageTarget): string => {
  if (language === "zh_tw") {
    return entry.zh_tw || entry.zh_cn;
  }
  if (language === "jp") {
    return entry.jp || entry.zh_cn;
  }
  return entry.zh_cn || entry.zh_tw;
};

const lookupMappedValue = async (
  value: string,
  category: MappingCandidateCategory,
  language: LanguageTarget,
): Promise<string | null> => {
  await ensureMappingsLoaded();

  const index = getIndexByCategory(category);
  const normalized = normalizeKeyword(value);
  const entry = index.get(normalized);
  if (!entry) {
    return null;
  }

  const mapped = pickLanguageValue(entry, language).replaceAll("删除", "").trim();
  return mapped.length > 0 ? mapped : null;
};

const mapByKeyword = async (
  value: string,
  category: MappingCandidateCategory,
  language: LanguageTarget,
): Promise<string> => {
  const mapped = await lookupMappedValue(value, category, language);
  if (mapped) {
    return mapped;
  }

  if (language === "zh_tw") {
    return convertToTraditional(value);
  }
  if (language === "zh_cn") {
    return convertToSimplified(value);
  }
  return value;
};

// ── Candidate management ───────────────────────────────────────────────

const enqueueCandidatePromotion = async (operation: () => Promise<void>): Promise<void> => {
  candidatePromotionQueue = candidatePromotionQueue
    .catch(() => {
      return;
    })
    .then(operation);

  return candidatePromotionQueue;
};

const resolveMappedForTarget = (
  row: JsonMappingRow,
  target: CandidateLanguageTarget,
  category: MappingCandidateCategory,
): string => {
  if (category === "actor") {
    return (row.canonical ?? row.jp ?? row.zh_cn ?? row.zh_tw ?? "").trim();
  }

  if (target === "zh_tw") {
    return (row.zh_tw ?? row.zh_cn ?? "").trim();
  }

  return (row.zh_cn ?? row.zh_tw ?? "").trim();
};

const findEntryByKeyword = (
  rows: JsonMappingRow[],
  normalizedKw: string,
  category: MappingCandidateCategory,
): JsonMappingRow | null => {
  for (const row of rows) {
    const rawKeywords =
      category === "actor"
        ? [
            ...toTokenArray(row.aliases),
            ...toTokenArray(row.keywords),
            ...toTokenArray(row.keyword),
            row.canonical ?? row.jp ?? row.zh_cn ?? row.zh_tw ?? "",
          ]
        : [...toTokenArray(row.keywords), ...toTokenArray(row.keyword)];

    const matched = rawKeywords.some((keyword) => normalizeKeyword(keyword) === normalizedKw);
    if (matched) {
      return row;
    }
  }

  return null;
};

const upsertUserMainMapping = async (record: MappingCandidateRecord): Promise<boolean> => {
  const document = await loadUserMappingDocument(record.category);
  const rows = document.entries ?? [];
  const matched = findEntryByKeyword(rows, record.normalizedKeyword, record.category);

  if (matched) {
    const current = resolveMappedForTarget(matched, record.target, record.category);
    if (current && current !== record.mapped) {
      return false;
    }

    if (record.category === "actor") {
      matched.canonical = record.mapped;

      const aliases = normalizeTokens([
        ...toTokenArray(matched.aliases),
        ...toTokenArray(matched.keywords),
        ...toTokenArray(matched.keyword),
        record.keyword,
      ]);
      matched.aliases = aliases;

      delete matched.keywords;
      delete matched.keyword;
      delete matched.zh_cn;
      delete matched.zh_tw;
      delete matched.jp;
    } else {
      if (record.target === "zh_cn") {
        matched.zh_cn = record.mapped;
        matched.zh_tw = matched.zh_tw ?? convertToTraditional(record.mapped);
      } else {
        matched.zh_tw = record.mapped;
        matched.zh_cn = matched.zh_cn ?? convertToSimplified(record.mapped);
      }
    }
  } else {
    const keyword = record.keyword.trim() || record.normalizedKeyword;

    if (record.category === "actor") {
      rows.push({
        canonical: record.mapped,
        aliases: normalizeTokens([keyword]),
      });
    } else {
      rows.push({
        zh_cn: record.target === "zh_cn" ? record.mapped : convertToSimplified(record.mapped),
        zh_tw: record.target === "zh_tw" ? record.mapped : convertToTraditional(record.mapped),
        jp: keyword,
        keywords: [keyword],
      });
    }
  }

  document.entries = rows;
  await saveUserMappingDocument(record.category, document);
  return true;
};

const tryAutoPromoteCandidate = async (record: MappingCandidateRecord, occurrenceCount: number): Promise<void> => {
  if (occurrenceCount < AUTO_PROMOTE_THRESHOLD) {
    return;
  }

  await ensureMappingsLoaded();

  const current = await lookupMappedValue(record.keyword, record.category, record.target);

  if (current === record.mapped) {
    return;
  }

  if (current && current !== record.mapped) {
    return;
  }

  const promoted = await upsertUserMainMapping(record);
  if (!promoted) {
    return;
  }

  loaded = false;
  await ensureMappingsLoaded();
};

// ── Public API ─────────────────────────────────────────────────────────

export const ensureMappingsLoaded = async (): Promise<void> => {
  if (loaded) {
    return;
  }

  const mappingDir = resolveMappingDirectory();
  const actorMappings = await loadJsonMappings(join(mappingDir, "mapping_actor.json"), "actor");
  const infoMappings = await loadJsonMappings(join(mappingDir, "mapping_info.json"), "genre");
  const actorUserMappings = await loadOptionalJsonMappings(resolveUserMappingFilePath("actor"), "actor");
  const infoUserMappings = await loadOptionalJsonMappings(resolveUserMappingFilePath("genre"), "genre");

  actorIndex = buildKeywordIndex([...actorUserMappings, ...actorMappings]);
  infoIndex = buildKeywordIndex([...infoUserMappings, ...infoMappings]);
  loaded = true;
};

export const appendMappingCandidate = async (input: {
  category: MappingCandidateCategory;
  keyword: string;
  mapped: string;
  target: CandidateLanguageTarget;
}): Promise<void> => {
  const normalizedKeyword = normalizeKeyword(input.keyword);
  const normalizedMapped = input.mapped.trim();

  if (!normalizedKeyword || !normalizedMapped) {
    return;
  }

  const record: MappingCandidateRecord = {
    category: input.category,
    keyword: input.keyword.trim(),
    normalizedKeyword,
    mapped: normalizedMapped,
    target: input.target,
    source: "llm",
    createdAt: new Date().toISOString(),
  };

  await enqueueCandidatePromotion(async () => {
    if (!candidateCountLoaded) {
      await loadCandidateCountsFromDisk(candidateCountIndex, buildCandidateCountKey);
      candidateCountLoaded = true;
    }

    const countKey = buildCandidateCountKey(record.normalizedKeyword, record.target, record.mapped);
    const currentCount = candidateCountIndex[record.category].get(countKey) ?? 0;
    const nextCount = currentCount + 1;
    candidateCountIndex[record.category].set(countKey, nextCount);

    const candidateDir = resolveCandidateDirectory();
    const fileName = MAPPING_CANDIDATE_FILE[input.category];
    const filePath = join(candidateDir, fileName);
    await enqueueCandidateWrite(
      () => candidateWriteQueue,
      (q) => {
        candidateWriteQueue = q;
      },
      filePath,
      JSON.stringify(record),
    );

    await tryAutoPromoteCandidate(record, nextCount);
  });
};

export const mapActorName = async (value: string, language: LanguageTarget = "zh_cn"): Promise<string> => {
  return mapByKeyword(value, "actor", language);
};

export const mapGenreName = async (value: string, language: LanguageTarget = "zh_cn"): Promise<string> => {
  return mapByKeyword(value, "genre", language);
};

export const findMappedActorName = async (
  value: string,
  language: LanguageTarget = "zh_cn",
): Promise<string | null> => {
  return lookupMappedValue(value, "actor", language);
};

export const findMappedGenreName = async (
  value: string,
  language: LanguageTarget = "zh_cn",
): Promise<string | null> => {
  return lookupMappedValue(value, "genre", language);
};

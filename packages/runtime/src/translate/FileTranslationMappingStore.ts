import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ActorMappingLanguageTarget,
  LanguageTarget,
  MappingCandidateCategory,
  TranslationMappingStore,
} from "../scrape/translate/types";
import { convertToSimplified, convertToTraditional, noopRuntimeLogger, type RuntimeLogger } from "../shared";

type CandidateLanguageTarget = LanguageTarget;

interface MappingEntry {
  zh_cn: string;
  zh_tw: string;
  jp: string;
  keywords: string[];
}

interface JsonMappingRow {
  canonical?: string;
  aliases?: string[] | string;
  zh_cn?: string;
  zh_tw?: string;
  jp?: string;
  keyword?: string;
  keywords?: string[] | string;
}

interface JsonMappingDocument {
  version?: number;
  source?: string;
  entries?: JsonMappingRow[];
}

interface MappingCandidateRecord {
  category: MappingCandidateCategory;
  keyword: string;
  normalizedKeyword: string;
  mapped: string;
  target: CandidateLanguageTarget;
  source: "llm";
  createdAt: string;
}

export interface FileTranslationMappingStoreOptions {
  bundledDirectory: string;
  writableDirectory: string;
  logger?: RuntimeLogger;
}

class TranslationMappingStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslationMappingStoreError";
  }
}

const AUTO_PROMOTE_THRESHOLD = 3;

const MAPPING_CANDIDATE_FILE: Record<MappingCandidateCategory, string> = {
  actor: "mapping_actor.candidates.jsonl",
  genre: "mapping_info.candidates.jsonl",
};

const MAPPING_USER_FILE: Record<MappingCandidateCategory, string> = {
  actor: "mapping_actor.user.json",
  genre: "mapping_info.user.json",
};

const MAPPING_BUNDLED_FILE: Record<MappingCandidateCategory, string> = {
  actor: "mapping_actor.json",
  genre: "mapping_info.json",
};

const normalizeKeyword = (input: string): string => input.normalize("NFC").trim().toUpperCase();

const toTokenArray = (value: string[] | string | undefined): string[] => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.split(",");
  return [];
};

const normalizeTokens = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeKeyword(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value.trim());
  }

  return result;
};

const toJsonRows = (payload: unknown): JsonMappingRow[] => {
  if (Array.isArray(payload)) return payload as JsonMappingRow[];
  if (!payload || typeof payload !== "object") return [];
  const entries = (payload as JsonMappingDocument).entries;
  return Array.isArray(entries) ? entries : [];
};

const toActorEntry = (row: JsonMappingRow): MappingEntry | null => {
  const canonical = (row.canonical ?? row.jp ?? row.zh_cn ?? row.zh_tw ?? "").trim();
  if (!canonical) return null;

  const keywords = normalizeTokens([
    ...toTokenArray(row.aliases),
    ...toTokenArray(row.keywords),
    ...toTokenArray(row.keyword),
    canonical,
  ]).map(normalizeKeyword);

  return keywords.length > 0 ? { zh_cn: canonical, zh_tw: canonical, jp: canonical, keywords } : null;
};

const toGenreEntry = (row: JsonMappingRow): MappingEntry | null => {
  const rawKeywords = Array.isArray(row.keywords)
    ? row.keywords
    : typeof row.keywords === "string"
      ? row.keywords.split(",")
      : typeof row.keyword === "string"
        ? row.keyword.split(",")
        : [];
  const keywords = rawKeywords.map(normalizeKeyword).filter(Boolean);
  return keywords.length > 0 ? { zh_cn: row.zh_cn ?? "", zh_tw: row.zh_tw ?? "", jp: row.jp ?? "", keywords } : null;
};

const isMissingFileError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

const buildCandidateCountKey = (normalizedKeyword: string, target: string, mapped: string): string =>
  `${normalizedKeyword}\0${target}\0${mapped}`;

export class FileTranslationMappingStore implements TranslationMappingStore {
  private readonly logger: RuntimeLogger;
  private loaded = false;
  private actorIndex = new Map<string, MappingEntry>();
  private genreIndex = new Map<string, MappingEntry>();
  private candidateCountsLoaded = false;
  private candidateQueue: Promise<void> = Promise.resolve();
  private readonly candidateCounts: Record<MappingCandidateCategory, Map<string, number>> = {
    actor: new Map(),
    genre: new Map(),
  };

  constructor(private readonly options: FileTranslationMappingStoreOptions) {
    this.logger = options.logger ?? noopRuntimeLogger;
  }

  async findMappedActorName(value: string, language: ActorMappingLanguageTarget = "zh_cn"): Promise<string | null> {
    return await this.lookup(value, "actor", language);
  }

  async findMappedGenreName(value: string, language: LanguageTarget = "zh_cn"): Promise<string | null> {
    return await this.lookup(value, "genre", language);
  }

  async appendMappingCandidate(input: {
    category: MappingCandidateCategory;
    keyword: string;
    mapped: string;
    target: LanguageTarget;
  }): Promise<void> {
    const normalizedKeyword = normalizeKeyword(input.keyword);
    const normalizedMapped = input.mapped.trim();
    if (!normalizedKeyword || !normalizedMapped) return;

    const record: MappingCandidateRecord = {
      category: input.category,
      keyword: input.keyword.trim(),
      normalizedKeyword,
      mapped: normalizedMapped,
      target: input.target,
      source: "llm",
      createdAt: new Date().toISOString(),
    };

    const operation = this.candidateQueue
      .catch(() => undefined)
      .then(async () => {
        await this.ensureCandidateCountsLoaded();
        const countKey = buildCandidateCountKey(record.normalizedKeyword, record.target, record.mapped);
        const nextCount = (this.candidateCounts[record.category].get(countKey) ?? 0) + 1;

        await mkdir(this.options.writableDirectory, { recursive: true });
        await appendFile(
          join(this.options.writableDirectory, MAPPING_CANDIDATE_FILE[record.category]),
          `${JSON.stringify(record)}\n`,
          "utf8",
        );
        this.candidateCounts[record.category].set(countKey, nextCount);
        await this.tryAutoPromote(record, nextCount);
      });

    this.candidateQueue = operation;
    try {
      await operation;
    } catch {
      const message = `Failed to persist ${input.category} translation mapping candidate`;
      this.logger.error(message);
      throw new TranslationMappingStoreError(message);
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    const [bundledActors, bundledGenres, userActors, userGenres] = await Promise.all([
      this.loadMappings("actor", join(this.options.bundledDirectory, MAPPING_BUNDLED_FILE.actor)),
      this.loadMappings("genre", join(this.options.bundledDirectory, MAPPING_BUNDLED_FILE.genre)),
      this.loadMappings("actor", join(this.options.writableDirectory, MAPPING_USER_FILE.actor)),
      this.loadMappings("genre", join(this.options.writableDirectory, MAPPING_USER_FILE.genre)),
    ]);

    this.actorIndex = this.buildIndex([...userActors, ...bundledActors]);
    this.genreIndex = this.buildIndex([...userGenres, ...bundledGenres]);
    this.loaded = true;
  }

  private async loadMappings(category: MappingCandidateCategory, filePath: string): Promise<MappingEntry[]> {
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
      const mapper = category === "actor" ? toActorEntry : toGenreEntry;
      return toJsonRows(parsed)
        .map(mapper)
        .filter((entry): entry is MappingEntry => entry !== null);
    } catch (error) {
      if (isMissingFileError(error)) return [];
      const message = `Failed to load ${category} translation mappings`;
      this.logger.error(message);
      throw new TranslationMappingStoreError(message);
    }
  }

  private buildIndex(entries: MappingEntry[]): Map<string, MappingEntry> {
    const index = new Map<string, MappingEntry>();
    for (const entry of entries) {
      for (const keyword of entry.keywords) {
        if (!index.has(keyword)) index.set(keyword, entry);
      }
    }
    return index;
  }

  private async lookup(
    value: string,
    category: MappingCandidateCategory,
    language: ActorMappingLanguageTarget,
  ): Promise<string | null> {
    await this.ensureLoaded();
    const entry = (category === "actor" ? this.actorIndex : this.genreIndex).get(normalizeKeyword(value));
    if (!entry) return null;

    const mapped =
      language === "zh_tw"
        ? entry.zh_tw || entry.zh_cn
        : language === "jp"
          ? entry.jp || entry.zh_cn
          : entry.zh_cn || entry.zh_tw;
    const cleaned = mapped.replaceAll("删除", "").trim();
    return cleaned || null;
  }

  private async ensureCandidateCountsLoaded(): Promise<void> {
    if (this.candidateCountsLoaded) return;

    for (const category of ["actor", "genre"] as const) {
      try {
        const content = await readFile(join(this.options.writableDirectory, MAPPING_CANDIDATE_FILE[category]), "utf8");
        for (const line of content.split(/\r?\n/u)) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const record = JSON.parse(trimmed) as Partial<MappingCandidateRecord>;
            const keyword =
              typeof record.normalizedKeyword === "string"
                ? record.normalizedKeyword
                : typeof record.keyword === "string"
                  ? normalizeKeyword(record.keyword)
                  : "";
            const mapped = typeof record.mapped === "string" ? record.mapped.trim() : "";
            const target = record.target === "zh_cn" || record.target === "zh_tw" ? record.target : null;
            if (!keyword || !mapped || !target) continue;
            const key = buildCandidateCountKey(keyword, target, mapped);
            this.candidateCounts[category].set(key, (this.candidateCounts[category].get(key) ?? 0) + 1);
          } catch {
            this.logger.warn(`Ignored malformed ${category} translation mapping candidate record`);
          }
        }
      } catch (error) {
        if (!isMissingFileError(error)) {
          const message = `Failed to load ${category} translation mapping candidates`;
          this.logger.error(message);
          throw new TranslationMappingStoreError(message);
        }
      }
    }

    this.candidateCountsLoaded = true;
  }

  private async tryAutoPromote(record: MappingCandidateRecord, count: number): Promise<void> {
    if (count < AUTO_PROMOTE_THRESHOLD) return;
    if (await this.lookup(record.keyword, record.category, record.target)) return;

    const document = await this.loadUserDocument(record.category);
    const rows = document.entries ?? [];
    const matched = this.findRow(rows, record.normalizedKeyword, record.category);

    if (matched) {
      const current = this.resolveMappedValue(matched, record.target, record.category);
      if (current && current !== record.mapped) return;
      this.updateRow(matched, record);
    } else {
      rows.push(this.createRow(record));
    }

    await mkdir(this.options.writableDirectory, { recursive: true });
    await writeFile(
      join(this.options.writableDirectory, MAPPING_USER_FILE[record.category]),
      `${JSON.stringify({ version: 1, source: "user", entries: rows }, null, 2)}\n`,
      "utf8",
    );
    this.loaded = false;
    await this.ensureLoaded();
  }

  private async loadUserDocument(category: MappingCandidateCategory): Promise<JsonMappingDocument> {
    const filePath = join(this.options.writableDirectory, MAPPING_USER_FILE[category]);
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as JsonMappingDocument;
      return { version: 1, source: "user", entries: toJsonRows(parsed) };
    } catch (error) {
      if (isMissingFileError(error)) return { version: 1, source: "user", entries: [] };
      const message = `Failed to load writable ${category} translation mappings`;
      this.logger.error(message);
      throw new TranslationMappingStoreError(message);
    }
  }

  private findRow(
    rows: JsonMappingRow[],
    normalizedKeyword: string,
    category: MappingCandidateCategory,
  ): JsonMappingRow | undefined {
    return rows.find((row) => {
      const values =
        category === "actor"
          ? [
              ...toTokenArray(row.aliases),
              ...toTokenArray(row.keywords),
              ...toTokenArray(row.keyword),
              row.canonical ?? row.jp ?? row.zh_cn ?? row.zh_tw ?? "",
            ]
          : [...toTokenArray(row.keywords), ...toTokenArray(row.keyword)];
      return values.some((value) => normalizeKeyword(value) === normalizedKeyword);
    });
  }

  private resolveMappedValue(
    row: JsonMappingRow,
    target: CandidateLanguageTarget,
    category: MappingCandidateCategory,
  ): string {
    if (category === "actor") return (row.canonical ?? row.jp ?? row.zh_cn ?? row.zh_tw ?? "").trim();
    return target === "zh_tw" ? (row.zh_tw ?? row.zh_cn ?? "").trim() : (row.zh_cn ?? row.zh_tw ?? "").trim();
  }

  private updateRow(row: JsonMappingRow, record: MappingCandidateRecord): void {
    if (record.category === "actor") {
      row.canonical = record.mapped;
      row.aliases = normalizeTokens([
        ...toTokenArray(row.aliases),
        ...toTokenArray(row.keywords),
        ...toTokenArray(row.keyword),
        record.keyword,
      ]);
      delete row.keywords;
      delete row.keyword;
      delete row.zh_cn;
      delete row.zh_tw;
      delete row.jp;
      return;
    }

    if (record.target === "zh_cn") {
      row.zh_cn = record.mapped;
      row.zh_tw ??= convertToTraditional(record.mapped);
    } else {
      row.zh_tw = record.mapped;
      row.zh_cn ??= convertToSimplified(record.mapped);
    }
  }

  private createRow(record: MappingCandidateRecord): JsonMappingRow {
    const keyword = record.keyword || record.normalizedKeyword;
    if (record.category === "actor") return { canonical: record.mapped, aliases: [keyword] };
    return {
      zh_cn: record.target === "zh_cn" ? record.mapped : convertToSimplified(record.mapped),
      zh_tw: record.target === "zh_tw" ? record.mapped : convertToTraditional(record.mapped),
      jp: keyword,
      keywords: [keyword],
    };
  }
}

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
import { normalizeKeyword } from "./normalization";
import { toActorEntry, toInfoEntry, toJsonRows } from "./parsing";
import type { JsonMappingDocument, MappingCandidateCategory, MappingCandidateRecord, MappingEntry } from "./types";

// ── Constants ──────────────────────────────────────────────────────────

export const MAPPING_CANDIDATE_FILE: Record<MappingCandidateCategory, string> = {
  actor: "mapping_actor.candidates.jsonl",
  genre: "mapping_info.candidates.jsonl",
};

export const MAPPING_USER_FILE: Record<MappingCandidateCategory, string> = {
  actor: "mapping_actor.user.json",
  genre: "mapping_info.user.json",
};

// ── Path resolution ────────────────────────────────────────────────────

export const resolveMappingDirectory = (): string => {
  if (app.isPackaged) {
    return join(app.getAppPath(), "resources", "mapping_table");
  }

  return join(process.cwd(), "resources", "mapping_table");
};

export const resolveCandidateDirectory = (): string => {
  try {
    return join(app.getPath("userData"), "mapping_table");
  } catch {
    return join(process.cwd(), "tmp", "mapping_table");
  }
};

export const resolveUserMappingFilePath = (category: MappingCandidateCategory): string => {
  return join(resolveCandidateDirectory(), MAPPING_USER_FILE[category]);
};

// ── File helpers ───────────────────────────────────────────────────────

export const isMissingFileError = (error: unknown): boolean => {
  return Boolean(
    typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (
        error as {
          code?: string;
        }
      ).code === "ENOENT",
  );
};

// ── Loading ────────────────────────────────────────────────────────────

export const loadJsonMappings = async (
  filePath: string,
  category: MappingCandidateCategory,
): Promise<MappingEntry[]> => {
  const content = await readFile(filePath, "utf8");
  const parsed = JSON.parse(content) as unknown;
  const mapper = category === "actor" ? toActorEntry : toInfoEntry;
  return toJsonRows(parsed)
    .map((row) => mapper(row))
    .filter((row): row is MappingEntry => row !== null);
};

export const loadOptionalJsonMappings = async (
  filePath: string,
  category: MappingCandidateCategory,
): Promise<MappingEntry[]> => {
  try {
    return await loadJsonMappings(filePath, category);
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }
};

export const loadUserMappingDocument = async (category: MappingCandidateCategory): Promise<JsonMappingDocument> => {
  const filePath = resolveUserMappingFilePath(category);

  try {
    const content = await readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as JsonMappingDocument;

    return {
      version: typeof parsed.version === "number" ? parsed.version : 1,
      source: typeof parsed.source === "string" ? parsed.source : "user",
      entries: toJsonRows(parsed),
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        version: 1,
        source: "user",
        entries: [],
      };
    }

    throw error;
  }
};

export const saveUserMappingDocument = async (
  category: MappingCandidateCategory,
  document: JsonMappingDocument,
): Promise<void> => {
  const candidateDir = resolveCandidateDirectory();
  await mkdir(candidateDir, { recursive: true });

  const filePath = resolveUserMappingFilePath(category);
  const payload: JsonMappingDocument = {
    version: 1,
    source: "user",
    entries: document.entries ?? [],
  };

  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

// ── Candidate counts ───────────────────────────────────────────────────

export const loadCandidateCounts = async (
  candidateCountIndex: Record<MappingCandidateCategory, Map<string, number>>,
  buildCandidateCountKey: (normalizedKeyword: string, target: string, mapped: string) => string,
): Promise<void> => {
  for (const category of ["actor", "genre"] as const) {
    const filePath = join(resolveCandidateDirectory(), MAPPING_CANDIDATE_FILE[category]);

    try {
      const content = await readFile(filePath, "utf8");
      const lines = content
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      for (const line of lines) {
        try {
          const record = JSON.parse(line) as Partial<MappingCandidateRecord>;
          const keyword =
            typeof record.normalizedKeyword === "string"
              ? record.normalizedKeyword
              : typeof record.keyword === "string"
                ? normalizeKeyword(record.keyword)
                : "";
          const mapped = typeof record.mapped === "string" ? record.mapped.trim() : "";
          const target = record.target === "zh_cn" || record.target === "zh_tw" ? record.target : null;

          if (!keyword || !mapped || !target) {
            continue;
          }

          const countKey = buildCandidateCountKey(keyword, target, mapped);
          const current = candidateCountIndex[category].get(countKey) ?? 0;
          candidateCountIndex[category].set(countKey, current + 1);
        } catch {}
      }
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }
};

// ── Candidate write queue ──────────────────────────────────────────────

export const enqueueCandidateWrite = (
  getQueue: () => Promise<void>,
  setQueue: (queue: Promise<void>) => void,
  filePath: string,
  line: string,
): Promise<void> => {
  const next = getQueue()
    .catch(() => {
      return;
    })
    .then(async () => {
      await mkdir(resolveCandidateDirectory(), { recursive: true });
      await appendFile(filePath, `${line}\n`, "utf8");
    });

  setQueue(next);
  return next;
};

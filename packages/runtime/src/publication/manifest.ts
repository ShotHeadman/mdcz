import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type {
  PublicationJournalManifest,
  PublicationJournalManifestEntry,
  PublicationJournalManifestObsolete,
  PublicationObsoleteObservation,
} from "./types";

const asRootFileRef = (value: unknown): RootFileRef | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.rootId !== "string" || typeof record.relativePath !== "string") return null;
  return { rootId: record.rootId, relativePath: record.relativePath };
};

const asManifestEntry = (value: unknown): PublicationJournalManifestEntry | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.rootId !== "string" || typeof record.relativePath !== "string") return null;
  if (typeof record.temporaryPath !== "string") return null;
  if (record.backupPath !== null && typeof record.backupPath !== "string") return null;
  if (typeof record.targetExisted !== "boolean") return null;
  return {
    rootId: record.rootId,
    relativePath: record.relativePath,
    temporaryPath: record.temporaryPath,
    backupPath: record.backupPath,
    targetExisted: record.targetExisted,
  };
};

const asObsoleteObservation = (value: unknown): PublicationObsoleteObservation | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.exists === false) return { exists: false };
  if (record.exists !== true) return null;
  if (typeof record.size !== "number" || typeof record.mtimeMs !== "number" || typeof record.isFile !== "boolean") {
    return null;
  }
  return { exists: true, size: record.size, mtimeMs: record.mtimeMs, isFile: record.isFile };
};

const asObsolete = (value: unknown): PublicationJournalManifestObsolete | null => {
  const ref = asRootFileRef(value);
  if (!ref) return null;
  const observed = asObsoleteObservation((value as { observed?: unknown }).observed);
  if (!observed) return null;
  return { ...ref, observed };
};

export const parsePublicationJournalManifest = (value: unknown): PublicationJournalManifest => {
  if (!value || typeof value !== "object") {
    throw new Error("Publication journal manifest is invalid");
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.entries) || !Array.isArray(record.obsolete)) {
    throw new Error("Publication journal manifest is invalid");
  }
  const entries: PublicationJournalManifestEntry[] = [];
  for (const item of record.entries) {
    const entry = asManifestEntry(item);
    if (!entry) throw new Error("Publication journal manifest is invalid");
    entries.push(entry);
  }
  const obsolete: PublicationJournalManifestObsolete[] = [];
  for (const item of record.obsolete) {
    const ref = asObsolete(item);
    if (!ref) throw new Error("Publication journal manifest is invalid");
    obsolete.push(ref);
  }
  return { entries, obsolete };
};

export const manifestRefs = (manifest: PublicationJournalManifest): RootFileRef[] => [
  ...manifest.entries,
  ...manifest.obsolete,
];

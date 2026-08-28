import { copyFile, mkdir, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { type MediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import { normalizeRootRelativePath, type RootFileRef } from "@mdcz/shared/mediaRef";
import { removeCommittedObsoleteFiles } from "./preflight";
import type {
  PublicationFileSystem,
  PublicationJournalManifest,
  PublicationJournalManifestEntry,
  PublicationJournalManifestObsolete,
  PublicationJournalPort,
  PublicationJournalRecord,
  PublicationObsoleteObservation,
  PublicationRepairPort,
} from "./types";

const defaultFileSystem: PublicationFileSystem = { copyFile, mkdir, readFile, rename, rm, stat, statfs, writeFile };

const unavailableCodes = new Set([
  "ESTALE",
  "ENOTCONN",
  "EIO",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "EHOSTDOWN",
  "ENETDOWN",
  "ENODEV",
]);

const toErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const errorCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException).code;

const isUnavailableError = (error: unknown): boolean => {
  const code = errorCode(error);
  return code !== undefined && unavailableCodes.has(code);
};

const exists = async (fileSystem: PublicationFileSystem, filePath: string): Promise<boolean> => {
  try {
    await fileSystem.stat(filePath);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
};

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

const parsePublicationJournalManifest = (value: unknown): PublicationJournalManifest | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.entries) || !Array.isArray(record.obsolete)) return null;
  const entries: PublicationJournalManifestEntry[] = [];
  for (const item of record.entries) {
    const entry = asManifestEntry(item);
    if (!entry) return null;
    entries.push(entry);
  }
  const obsolete: PublicationJournalManifestObsolete[] = [];
  for (const item of record.obsolete) {
    const ref = asObsolete(item);
    if (!ref) return null;
    obsolete.push(ref);
  }
  return { entries, obsolete };
};

const repairType = (operationType: string): "scrape" | "maintenance" =>
  operationType === "scrape" ? "scrape" : "maintenance";

export interface RecoverPublicationsOptions {
  journal: PublicationJournalPort;
  resolveRoot(rootId: string): Promise<Pick<MediaRoot, "id" | "hostPath">>;
  repairIssues?: PublicationRepairPort;
  fileSystem?: PublicationFileSystem;
}

const recordRepair = async (
  options: RecoverPublicationsOptions,
  entry: PublicationJournalRecord,
  ref: RootFileRef,
  error: unknown,
): Promise<void> => {
  await options.repairIssues?.record({
    operationId: entry.operationId,
    operationType: repairType(entry.operationType),
    rootId: ref.rootId,
    relativePath: ref.relativePath,
    errorMessage: toErrorMessage(error),
  });
};

const rootsOf = (manifest: PublicationJournalManifest): string[] => [
  ...new Set([...manifest.entries, ...manifest.obsolete].map((ref) => ref.rootId)),
];

const resolveAbsolute = async (
  options: RecoverPublicationsOptions,
  rootId: string,
  relativePath: string,
): Promise<string> => {
  const root = await options.resolveRoot(rootId);
  return resolveRootRelativePath(root, normalizeRootRelativePath(relativePath));
};

const allRootsAvailable = async (
  options: RecoverPublicationsOptions,
  fileSystem: PublicationFileSystem,
  manifest: PublicationJournalManifest,
): Promise<boolean> => {
  for (const rootId of rootsOf(manifest)) {
    try {
      const root = await options.resolveRoot(rootId);
      await fileSystem.stat(root.hostPath);
    } catch {
      return false;
    }
  }
  return true;
};

const resolveRepairs = async (
  options: RecoverPublicationsOptions,
  entry: PublicationJournalRecord,
  refs: readonly RootFileRef[],
): Promise<void> => {
  for (const item of refs) {
    await options.repairIssues?.resolve(entry.operationId, item.rootId, item.relativePath);
  }
};

const recoverPending = async (
  options: RecoverPublicationsOptions,
  fileSystem: PublicationFileSystem,
  entry: PublicationJournalRecord,
  manifest: PublicationJournalManifest,
  resolve: (rootId: string, relativePath: string) => Promise<string>,
): Promise<"done" | "retain"> => {
  for (const item of [...manifest.entries].reverse()) {
    const targetPath = await resolve(item.rootId, item.relativePath);
    try {
      const backupExists = item.backupPath ? await exists(fileSystem, item.backupPath) : false;
      if (backupExists && item.backupPath) {
        await fileSystem.rename(item.backupPath, targetPath);
        await fileSystem.rm(item.temporaryPath, { force: true });
        continue;
      }
      if (item.targetExisted) {
        if (!(await exists(fileSystem, targetPath))) {
          await recordRepair(
            options,
            entry,
            item,
            new Error(`Pending publication is missing both backup and target: ${item.rootId}:${item.relativePath}`),
          );
          return "retain";
        }
        await fileSystem.rm(item.temporaryPath, { force: true });
        continue;
      }
      await fileSystem.rm(targetPath, { force: true });
      await fileSystem.rm(item.temporaryPath, { force: true });
    } catch (error) {
      if (isUnavailableError(error)) return "retain";
      await recordRepair(options, entry, item, error);
      return "retain";
    }
  }
  await resolveRepairs(options, entry, [...manifest.entries, ...manifest.obsolete]);
  options.journal.finish(entry.operationId);
  return "done";
};

const recoverCommitted = async (
  options: RecoverPublicationsOptions,
  fileSystem: PublicationFileSystem,
  entry: PublicationJournalRecord,
  manifest: PublicationJournalManifest,
  resolve: (rootId: string, relativePath: string) => Promise<string>,
): Promise<"done" | "retain"> => {
  for (const item of manifest.entries) {
    const targetPath = await resolve(item.rootId, item.relativePath);
    try {
      if (!(await exists(fileSystem, targetPath))) {
        await recordRepair(
          options,
          entry,
          item,
          new Error(`Committed publication is missing target: ${item.rootId}:${item.relativePath}`),
        );
        return "retain";
      }
      if (item.backupPath) await fileSystem.rm(item.backupPath, { force: true });
      await fileSystem.rm(item.temporaryPath, { force: true });
    } catch (error) {
      if (isUnavailableError(error)) return "retain";
      await recordRepair(options, entry, item, error);
      return "retain";
    }
  }
  let retainedObsolete: RootFileRef[] = [];
  try {
    retainedObsolete = await removeCommittedObsoleteFiles(fileSystem, manifest.obsolete, resolve);
  } catch (error) {
    if (isUnavailableError(error)) return "retain";
    const ref = manifest.obsolete[0] ?? manifest.entries[0];
    if (ref) await recordRepair(options, entry, ref, error);
    return "retain";
  }
  for (const ref of retainedObsolete) {
    await recordRepair(
      options,
      entry,
      ref,
      new Error(`Committed publication obsolete path changed: ${ref.rootId}:${ref.relativePath}`),
    );
  }
  const retainedKeys = new Set(retainedObsolete.map((ref) => `${ref.rootId}\0${ref.relativePath}`));
  await resolveRepairs(options, entry, [
    ...manifest.entries,
    ...manifest.obsolete.filter((ref) => !retainedKeys.has(`${ref.rootId}\0${ref.relativePath}`)),
  ]);
  options.journal.finish(entry.operationId);
  return "done";
};

export const recoverPublications = async (options: RecoverPublicationsOptions): Promise<void> => {
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  for (const entry of options.journal.listUnfinished()) {
    const manifest = parsePublicationJournalManifest(entry.manifest);
    if (!manifest) {
      await recordRepair(
        options,
        entry,
        { rootId: "unknown", relativePath: entry.operationId },
        new Error("Publication journal manifest is invalid"),
      );
      continue;
    }
    if (!(await allRootsAvailable(options, fileSystem, manifest))) continue;
    const resolve = async (rootId: string, relativePath: string) =>
      await resolveAbsolute(options, rootId, relativePath);
    try {
      if (entry.state === "pending") {
        await recoverPending(options, fileSystem, entry, manifest, resolve);
        continue;
      }
      await recoverCommitted(options, fileSystem, entry, manifest, resolve);
    } catch (error) {
      if (isUnavailableError(error)) continue;
      const ref = manifest.entries[0] ?? manifest.obsolete[0] ?? { rootId: "unknown", relativePath: entry.operationId };
      await recordRepair(options, entry, ref, error);
    }
  }
};

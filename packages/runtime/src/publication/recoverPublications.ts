import { copyFile, mkdir, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { type MediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import { parseWireRelativePath, type RootFileRef } from "@mdcz/shared/mediaRef";
import { PublicationJournalAdapter } from "./journalAdapter";
import { removeCommittedObsoleteFiles } from "./preflight";
import type {
  PublicationFileSystem,
  PublicationJournalManifest,
  PublicationJournalPort,
  PublicationJournalRecord,
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
  entry: Pick<PublicationJournalRecord, "operationId" | "operationType">,
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
  return resolveRootRelativePath(root, parseWireRelativePath(relativePath));
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
    const temporaryPath = await resolve(item.rootId, item.temporaryPath);
    const backupPath = item.backupPath ? await resolve(item.rootId, item.backupPath) : null;
    try {
      const backupExists = backupPath ? await exists(fileSystem, backupPath) : false;
      if (backupExists && backupPath) {
        await fileSystem.rename(backupPath, targetPath);
        await fileSystem.rm(temporaryPath, { force: true });
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
        await fileSystem.rm(temporaryPath, { force: true });
        continue;
      }
      await fileSystem.rm(targetPath, { force: true });
      await fileSystem.rm(temporaryPath, { force: true });
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
    const temporaryPath = await resolve(item.rootId, item.temporaryPath);
    const backupPath = item.backupPath ? await resolve(item.rootId, item.backupPath) : null;
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
      if (backupPath) await fileSystem.rm(backupPath, { force: true });
      await fileSystem.rm(temporaryPath, { force: true });
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
  const unfinished = options.journal.listUnfinished();
  if (options.journal instanceof PublicationJournalAdapter) {
    for (const invalid of options.journal.invalidManifests()) {
      await recordRepair(
        options,
        invalid,
        { rootId: "unknown", relativePath: invalid.operationId },
        new Error("Publication journal manifest is invalid"),
      );
    }
  }
  for (const entry of unfinished) {
    const manifest = entry.manifest;
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

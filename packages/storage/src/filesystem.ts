import { stat as fsStat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { StorageError, storageErrorCodes, toStorageError } from "./errors";
import type { MediaRoot } from "./mediaRoot";
import { normalizeRootRelativePath, type RootRelativePath, resolveRootRelativePath } from "./rootRelativePath";

export interface StorageEntry {
  name: string;
  path: RootRelativePath;
  kind: "file" | "directory" | "other";
  size: number;
  modifiedAt: Date;
}

export const statRootPath = async (root: MediaRoot, relativePath: string): Promise<StorageEntry> => {
  assertStorageRootEnabled(root);
  const normalizedRelativePath = normalizeRootRelativePath(relativePath);
  const absolutePath = resolveRootRelativePath(root, relativePath);

  try {
    const stats = await fsStat(absolutePath);
    return {
      name: path.basename(absolutePath),
      path: normalizedRelativePath,
      kind: stats.isFile() ? "file" : stats.isDirectory() ? "directory" : "other",
      size: stats.size,
      modifiedAt: stats.mtime,
    };
  } catch (error) {
    throw toStorageError(error, relativePath);
  }
};

export const readRootFile = async (root: MediaRoot, relativePath: string): Promise<Buffer> => {
  assertStorageRootEnabled(root);
  const absolutePath = resolveRootRelativePath(root, relativePath);

  try {
    return await readFile(absolutePath);
  } catch (error) {
    throw toStorageError(error, relativePath);
  }
};

export const listRootDirectory = async (root: MediaRoot, relativePath = ""): Promise<StorageEntry[]> => {
  assertStorageRootEnabled(root);
  const absolutePath = resolveRootRelativePath(root, relativePath);

  try {
    const entries = await readdir(absolutePath, { withFileTypes: true });

    return await Promise.all(
      entries.map(async (entry) => {
        const entryRelativePath = normalizeRootRelativePath(path.posix.join(relativePath, entry.name));
        const stats = await fsStat(resolveRootRelativePath(root, entryRelativePath));
        return {
          name: entry.name,
          path: entryRelativePath,
          kind: entry.isFile() ? "file" : entry.isDirectory() ? "directory" : "other",
          size: stats.size,
          modifiedAt: stats.mtime,
        };
      }),
    );
  } catch (error) {
    throw toStorageError(error, relativePath);
  }
};

export interface RootFileWalkEntry {
  absolutePath: string;
  relativePath: RootRelativePath;
  size: number;
  modifiedAt: Date;
}

const resolveDirectoryKey = async (dirPath: string): Promise<string> => {
  try {
    return await realpath(dirPath);
  } catch {
    return dirPath;
  }
};

const walkRootDirectory = async (
  root: MediaRoot,
  relativePath: string,
  recursive: boolean,
  visitedDirs: Set<string>,
  ancestorDirs: Set<string>,
  allowVisitedTarget = false,
): Promise<RootFileWalkEntry[]> => {
  const absolutePath = resolveRootRelativePath(root, relativePath);
  const dirKey = await resolveDirectoryKey(absolutePath);
  if (ancestorDirs.has(dirKey) || (!allowVisitedTarget && visitedDirs.has(dirKey))) {
    return [];
  }
  visitedDirs.add(dirKey);
  const nextAncestorDirs = new Set(ancestorDirs).add(dirKey);

  const entries = await readdir(absolutePath, { withFileTypes: true });
  const files: RootFileWalkEntry[] = [];

  for (const entry of entries) {
    const entryRelativePath = normalizeRootRelativePath(path.posix.join(relativePath, entry.name));
    const entryAbsolutePath = resolveRootRelativePath(root, entryRelativePath);

    try {
      if (entry.isDirectory()) {
        if (recursive) {
          files.push(...(await walkRootDirectory(root, entryRelativePath, true, visitedDirs, nextAncestorDirs)));
        }
        continue;
      }

      if (entry.isFile() || entry.isSymbolicLink()) {
        const stats = await fsStat(entryAbsolutePath);
        if (stats.isDirectory()) {
          if (recursive) {
            files.push(
              ...(await walkRootDirectory(root, entryRelativePath, true, visitedDirs, nextAncestorDirs, true)),
            );
          }
          continue;
        }

        if (stats.isFile()) {
          files.push({
            absolutePath: entryAbsolutePath,
            relativePath: entryRelativePath,
            size: stats.size,
            modifiedAt: stats.mtime,
          });
        }
      }
    } catch {
      // Keep mounted filesystem scans resilient to inaccessible entries.
    }
  }

  return files;
};

export const listRootFiles = async (
  root: MediaRoot,
  relativePath = "",
  recursive = false,
): Promise<RootFileWalkEntry[]> => {
  assertStorageRootEnabled(root);
  const normalizedRelativePath = normalizeRootRelativePath(relativePath);

  try {
    return await walkRootDirectory(root, normalizedRelativePath, recursive, new Set<string>(), new Set<string>());
  } catch (error) {
    throw toStorageError(error, relativePath);
  }
};

export const mkdirpRootPath = async (root: MediaRoot, relativePath: string): Promise<void> => {
  assertStorageRootEnabled(root);
  const absolutePath = resolveRootRelativePath(root, relativePath);

  try {
    await mkdir(absolutePath, { recursive: true });
  } catch (error) {
    throw toStorageError(error, relativePath);
  }
};

export const atomicWriteRootFile = async (
  root: MediaRoot,
  relativePath: string,
  content: string | Uint8Array,
): Promise<void> => {
  assertStorageRootEnabled(root);
  const absolutePath = resolveRootRelativePath(root, relativePath);
  const parent = path.dirname(absolutePath);
  const tempPath = path.join(parent, `.${path.basename(absolutePath)}.${process.pid}.${Date.now()}.tmp`);

  try {
    await mkdir(parent, { recursive: true });
    await writeFile(tempPath, content);
    await rename(tempPath, absolutePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw toStorageError(error, relativePath);
  }
};

export const assertStorageRootEnabled = (root: MediaRoot): void => {
  if (!root.enabled) {
    throw new StorageError(storageErrorCodes.UnsupportedOperation, `Media root is disabled: ${root.id}`);
  }
};

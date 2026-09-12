import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import {
  copyFile,
  stat as fsStat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { toStorageError } from "./errors";
import { isPathInside, type MediaRoot } from "./mediaRoot";
import { normalizeRootRelativePath, type RootRelativePath, resolveRootRelativePath } from "./rootRelativePath";

export interface StorageEntry {
  name: string;
  path: RootRelativePath;
  kind: "file" | "directory" | "other";
  size: number;
  modifiedAt: Date;
}

export const statRootPath = async (root: MediaRoot, relativePath: string): Promise<StorageEntry> => {
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
  const absolutePath = resolveRootRelativePath(root, relativePath);

  try {
    return await readFile(absolutePath);
  } catch (error) {
    throw toStorageError(error, relativePath);
  }
};

export const listRootDirectory = async (root: MediaRoot, relativePath = ""): Promise<StorageEntry[]> => {
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

export interface FileWalkOptions {
  filterFile?: (absolutePath: string) => boolean | Promise<boolean>;
  excludeDirectoryPaths?: readonly string[];
  excludeFileSymlinks?: boolean;
  deduplicateDirectories?: boolean;
  warnings?: { count: number; paths: string[] };
  // Metadata consumers collect their own results; callback scans return no paths.
  onFile?: (filePath: string, stats: Stats) => void;
  onDiagnostic?: (message: string) => void;
}

export const walkFiles = async (
  rootPath: string,
  recursive = false,
  signal?: AbortSignal,
  options: FileWalkOptions = {},
): Promise<string[]> => {
  signal?.throwIfAborted();
  const started = performance.now();
  let directories = 0;
  let candidates = 0;
  const visitedDirectories = new Set<string>();
  const files: string[] = [];
  const warnings = options.warnings ?? { count: 0, paths: [] as string[] };
  const skip = (error: unknown, target: string): boolean => {
    signal?.throwIfAborted();
    if (!["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ELOOP"].includes((error as NodeJS.ErrnoException)?.code ?? ""))
      return false;
    warnings.count += 1;
    if (warnings.paths.length < 5) warnings.paths.push(target);
    return true;
  };
  const keys = new Map<string, Promise<string>>();
  const directoryKey = (target: string) => {
    signal?.throwIfAborted();
    let pending = keys.get(target);
    if (!pending) {
      pending = realpath(target);
      keys.set(target, pending);
    }
    return pending;
  };
  const excluded: string[] = [];
  const lexicalExcluded = (options.excludeDirectoryPaths ?? [])
    .map((target) => path.resolve(target))
    .filter((target) => path.relative(rootPath, target) !== "");
  const queue: Array<() => Promise<void>> = [];
  const visit = async (absolutePath: string, ancestors: ReadonlySet<string>, isRoot: boolean) => {
    // Skip excluded names before I/O, then reject aliases of excluded targets.
    if (!isRoot && lexicalExcluded.some((target) => isPathInside(target, absolutePath))) return;
    const key = await directoryKey(absolutePath);
    if (ancestors.has(key) || (options.deduplicateDirectories && visitedDirectories.has(key))) return;
    if (!isRoot && excluded.some((target) => isPathInside(target, key))) return;
    if (options.deduplicateDirectories) visitedDirectories.add(key);
    const nextAncestors = options.deduplicateDirectories ? ancestors : new Set(ancestors).add(key);
    signal?.throwIfAborted();
    const entries = await readdir(absolutePath, { withFileTypes: true });
    signal?.throwIfAborted();
    directories += 1;
    for (const entry of entries) {
      const entryAbsolutePath = path.join(absolutePath, entry.name);
      if (entry.isDirectory()) {
        if (recursive)
          queue.push(() =>
            visit(entryAbsolutePath, nextAncestors, false).catch((error) => {
              if (!skip(error, entryAbsolutePath)) throw error;
            }),
          );
        continue;
      }
      const accepted = !options.filterFile || (await options.filterFile(entryAbsolutePath));
      if (entry.isFile() && !accepted) continue;
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      if (entry.isFile() && !options.onFile) {
        candidates += 1;
        files.push(entryAbsolutePath);
        continue;
      }
      queue.push(async () => {
        try {
          signal?.throwIfAborted();
          const stats = await fsStat(entryAbsolutePath);
          signal?.throwIfAborted();
          if (stats.isDirectory()) {
            if (recursive)
              queue.push(() =>
                visit(entryAbsolutePath, nextAncestors, false).catch((error) => {
                  if (!skip(error, entryAbsolutePath)) throw error;
                }),
              );
            return;
          }
          if (stats.isFile() && accepted && !(entry.isSymbolicLink() && options.excludeFileSymlinks)) {
            candidates += 1;
            if (options.onFile) options.onFile(entryAbsolutePath, stats);
            else files.push(entryAbsolutePath);
          }
        } catch (error) {
          if (!skip(error, entryAbsolutePath)) throw error;
        }
      });
    }
  };
  try {
    const rootKey = await directoryKey(rootPath);
    for (const target of recursive ? lexicalExcluded : []) {
      try {
        const key = await directoryKey(target);
        if (key !== rootKey) excluded.push(key);
      } catch (error) {
        signal?.throwIfAborted();
        if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException)?.code ?? "")) continue;
        if (!skip(error, target)) throw error;
      }
    }
    queue.push(() => visit(rootPath, new Set(), true));
    await new Promise<void>((resolveDone, reject) => {
      let active = 0;
      let cursor = 0;
      let failed = false;
      let failure: unknown;
      const pump = () => {
        while (!failed && active < 4 && cursor < queue.length) {
          const task = queue[cursor++];
          if (!task) throw new Error("Missing filesystem task");
          active += 1;
          void task()
            .catch((error) => {
              failed = true;
              failure = error;
            })
            .finally(() => {
              active -= 1;
              pump();
            });
        }
        if (active === 0) {
          if (failed) reject(failure);
          else resolveDone();
        }
      };
      pump();
    });
    signal?.throwIfAborted();
    return options.onFile ? files : files.sort((a, b) => a.localeCompare(b, "zh-CN"));
  } finally {
    options.onDiagnostic?.(
      `扫描汇总 ${JSON.stringify({ path: rootPath, recursive, elapsedMs: Math.round(performance.now() - started), directories, candidates, skipped: warnings.count })}`,
    );
  }
};

export type RootFileWalkOptions = Omit<FileWalkOptions, "onFile">;

export const listRootFiles = async (
  root: MediaRoot,
  relativePath = "",
  recursive = false,
  signal?: AbortSignal,
  options: RootFileWalkOptions = {},
): Promise<RootFileWalkEntry[]> => {
  const rootPath = resolveRootRelativePath(root, relativePath);
  const files: RootFileWalkEntry[] = [];
  try {
    await walkFiles(rootPath, recursive, signal, {
      ...options,
      onFile: (absolutePath, stats) => {
        files.push({
          absolutePath,
          relativePath: normalizeRootRelativePath(path.relative(root.hostPath, absolutePath)),
          size: stats.size,
          modifiedAt: stats.mtime,
        });
      },
    });
    return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "zh-CN"));
  } catch (error) {
    signal?.throwIfAborted();
    throw toStorageError(error, relativePath);
  }
};

export const mkdirpRootPath = async (root: MediaRoot, relativePath: string): Promise<void> => {
  const absolutePath = resolveRootRelativePath(root, relativePath);

  try {
    await mkdir(absolutePath, { recursive: true });
  } catch (error) {
    throw toStorageError(error, relativePath);
  }
};

const assertAbsolutePath = (value: string, label: string): void => {
  if (!path.isAbsolute(value)) {
    throw new TypeError(`${label} must be an absolute path: ${value}`);
  }
};

const attachCleanupError = (error: unknown, cleanupError: unknown): void => {
  if (!(error instanceof Error)) return;

  const property = error.cause === undefined ? "cause" : "cleanupError";
  try {
    Object.defineProperty(error, property, {
      configurable: true,
      value: cleanupError,
    });
  } catch {
    // Preserve the original error even when it cannot be extended.
  }
};

const publishFileAtomically = async (
  targetPath: string,
  populateTemporaryFile: (temporaryPath: string) => Promise<void>,
): Promise<void> => {
  const parent = path.dirname(targetPath);
  const temporaryPath = path.join(parent, `.${path.basename(targetPath)}.${randomUUID()}.tmp`);
  let ownsTemporaryFile = false;

  try {
    await mkdir(parent, { recursive: true });
    const temporaryFile = await open(temporaryPath, "wx");
    ownsTemporaryFile = true;
    await temporaryFile.close();
    await populateTemporaryFile(temporaryPath);
    await rename(temporaryPath, targetPath);
  } catch (error) {
    if (ownsTemporaryFile) {
      try {
        await rm(temporaryPath, { force: true });
      } catch (cleanupError) {
        attachCleanupError(error, cleanupError);
      }
    }
    throw error;
  }
};

export const atomicWriteFile = async (filePath: string, content: string | Uint8Array): Promise<void> => {
  assertAbsolutePath(filePath, "filePath");
  await publishFileAtomically(filePath, async (temporaryPath) => {
    await writeFile(temporaryPath, content);
  });
};

export const atomicCopyFile = async (sourcePath: string, targetPath: string): Promise<void> => {
  assertAbsolutePath(sourcePath, "sourcePath");
  assertAbsolutePath(targetPath, "targetPath");
  await publishFileAtomically(targetPath, async (temporaryPath) => {
    await copyFile(sourcePath, temporaryPath);
  });
};

export const atomicWriteRootFile = async (
  root: MediaRoot,
  relativePath: string,
  content: string | Uint8Array,
): Promise<void> => {
  await atomicWriteFile(resolveRootRelativePath(root, relativePath), content);
};

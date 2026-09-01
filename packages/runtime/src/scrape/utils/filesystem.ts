import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { copyFile, mkdir, readdir, realpath, rename, rm, stat, statfs } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { SUPPORTED_MEDIA_EXTENSIONS_WITH_DOT } from "@mdcz/shared/mediaExtensions";
import { throwIfAborted } from "./abort";

export const DEFAULT_VIDEO_EXTENSIONS = new Set(SUPPORTED_MEDIA_EXTENSIONS_WITH_DOT);

export const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

export const isPathInside = (rootPath: string, candidatePath: string): boolean => {
  const candidateRelativePath = relative(resolve(rootPath), resolve(candidatePath));
  return (
    candidateRelativePath === "" ||
    (!candidateRelativePath.startsWith(`..${sep}`) &&
      candidateRelativePath !== ".." &&
      !isAbsolute(candidateRelativePath))
  );
};

const resolveDirectoryKey = async (dirPath: string): Promise<string> => {
  try {
    return await realpath(dirPath);
  } catch {
    return dirPath;
  }
};

const isSkippableDirectoryReadError = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "EACCES" || code === "EPERM";
};

const walkDirectory = async (
  dirPath: string,
  recursive: boolean,
  visitedDirs: Set<string>,
  excludedDirs: ReadonlySet<string>,
  signal?: AbortSignal,
  isRoot = false,
): Promise<string[]> => {
  throwIfAborted(signal);
  const dirKey = await resolveDirectoryKey(dirPath);
  if (visitedDirs.has(dirKey) || excludedDirs.has(dirKey)) {
    return [];
  }
  visitedDirs.add(dirKey);

  let entries: Dirent[];
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (!isRoot && isSkippableDirectoryReadError(error)) {
      return [];
    }
    throw error;
  }
  const files: string[] = [];

  for (const entry of entries) {
    throwIfAborted(signal);
    const absolutePath = join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (recursive) {
        files.push(...(await walkDirectory(absolutePath, true, visitedDirs, excludedDirs, signal, false)));
      }
      continue;
    }

    if (entry.isFile()) {
      files.push(absolutePath);
      continue;
    }

    if (entry.isSymbolicLink()) {
      try {
        const targetStats = await stat(absolutePath);
        if (targetStats.isDirectory()) {
          if (recursive) {
            files.push(...(await walkDirectory(absolutePath, true, visitedDirs, excludedDirs, signal, false)));
          }
          continue;
        }

        if (targetStats.isFile()) {
          files.push(absolutePath);
        }
      } catch {
        // Ignore broken or inaccessible symlink entries during scanning.
      }
    }
  }

  return files;
};

export const listFiles = async (
  dirPath: string,
  recursive = false,
  signal?: AbortSignal,
  excludeDirectoryPaths: readonly string[] = [],
): Promise<string[]> => {
  const rootKey = await resolveDirectoryKey(dirPath);
  const excludedKeys = new Set<string>();

  for (const excludedPath of excludeDirectoryPaths) {
    const trimmedPath = excludedPath.trim();
    if (!trimmedPath) {
      continue;
    }

    const excludedKey = await resolveDirectoryKey(trimmedPath);
    if (excludedKey === rootKey) {
      continue;
    }

    excludedKeys.add(excludedKey);
  }

  return walkDirectory(dirPath, recursive, new Set<string>(), excludedKeys, signal, true);
};

export const listVideoFiles = async (
  dirPath: string,
  recursive = false,
  extensions: Set<string> = DEFAULT_VIDEO_EXTENSIONS,
  signal?: AbortSignal,
  excludeDirectoryPaths: readonly string[] = [],
): Promise<string[]> => {
  const files = await listFiles(dirPath, recursive, signal, excludeDirectoryPaths);
  return files.filter((filePath) => extensions.has(extname(filePath).toLowerCase()));
};

export const ensureParentDirectory = async (targetPath: string): Promise<void> => {
  await mkdir(dirname(targetPath), { recursive: true });
};

export const resolveAvailablePath = async (targetPath: string, ignoreExistingPath?: string): Promise<string> => {
  const parsed = parse(targetPath);
  const ignored = ignoreExistingPath ? resolve(ignoreExistingPath) : null;
  let resolvedPath = targetPath;
  let suffix = 1;

  while (await pathExists(resolvedPath)) {
    if (ignored && resolve(resolvedPath) === ignored) {
      return resolvedPath;
    }

    resolvedPath = join(parsed.dir, `${parsed.name} (${suffix})${parsed.ext}`);
    suffix += 1;
  }

  return resolvedPath;
};

const cleanupFailedCrossDeviceTarget = async (
  sourcePath: string,
  targetPath: string,
  operation: string,
  error: unknown,
): Promise<never> => {
  try {
    await rm(targetPath, { force: true });
  } catch (cleanupError) {
    const operationMessage = error instanceof Error ? error.message : String(error);
    const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    throw new Error(
      `Failed to ${operation} for ${sourcePath} to ${targetPath}: ${operationMessage}. Failed to clean up target ${targetPath}: ${cleanupMessage}`,
      { cause: error },
    );
  }

  throw error;
};

const createCrossDeviceTemporaryPath = (targetPath: string): string => {
  const parsed = parse(targetPath);
  return join(parsed.dir, `.${parsed.base}.${randomUUID()}.part`);
};

export const moveFileSafely = async (sourcePath: string, targetPath: string): Promise<string> => {
  await ensureParentDirectory(targetPath);
  if (resolve(sourcePath) !== resolve(targetPath) && (await pathExists(targetPath))) {
    throw new Error(`Target already exists: ${targetPath}`);
  }

  try {
    await rename(sourcePath, targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== "EXDEV") {
      throw error;
    }

    const temporaryPath = createCrossDeviceTemporaryPath(targetPath);

    try {
      await copyFile(sourcePath, temporaryPath);
      const [source, copied] = await Promise.all([stat(sourcePath), stat(temporaryPath)]);
      if (!copied.isFile() || copied.size !== source.size) {
        throw new Error(`Copied file size mismatch: expected ${source.size}, received ${copied.size}`);
      }
    } catch (copyError) {
      await cleanupFailedCrossDeviceTarget(sourcePath, temporaryPath, "copy", copyError);
    }

    try {
      await rename(temporaryPath, targetPath);
    } catch (publishError) {
      await cleanupFailedCrossDeviceTarget(sourcePath, temporaryPath, "publish copied file", publishError);
    }
  }

  return targetPath;
};

export const hasEnoughDiskSpace = async (targetPath: string, requiredBytes: number): Promise<boolean> => {
  const info = await statfs(targetPath);
  const availableBytes = info.bsize * info.bavail;
  return availableBytes >= requiredBytes;
};

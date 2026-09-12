import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rename, rm, stat, statfs } from "node:fs/promises";
import { dirname, extname, join, parse, resolve } from "node:path";
import { type FileWalkOptions, walkFiles } from "@mdcz/media-store";

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

export const listFiles = async (
  dirPath: string,
  recursive = false,
  signal?: AbortSignal,
  excludeDirectoryPaths: readonly string[] = [],
  options: FileWalkOptions = {},
): Promise<string[]> => {
  try {
    return await walkFiles(dirPath, recursive, signal, {
      ...options,
      excludeDirectoryPaths,
      deduplicateDirectories: true,
    });
  } catch (error) {
    throwIfAborted(signal);
    throw error;
  }
};

export const listVideoFiles = async (
  dirPath: string,
  recursive = false,
  extensions: Set<string> = DEFAULT_VIDEO_EXTENSIONS,
  signal?: AbortSignal,
  excludeDirectoryPaths: readonly string[] = [],
  options: FileWalkOptions = {},
): Promise<string[]> =>
  listFiles(dirPath, recursive, signal, excludeDirectoryPaths, {
    ...options,
    filterFile: async (path) =>
      extensions.has(extname(path).toLowerCase()) && (!options.filterFile || (await options.filterFile(path))),
  });

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
    try {
      await rm(sourcePath, { force: true });
    } catch (removeError) {
      await cleanupFailedCrossDeviceTarget(sourcePath, targetPath, "remove source", removeError);
    }
  }

  return targetPath;
};

export const hasEnoughDiskSpace = async (targetPath: string, requiredBytes: number): Promise<boolean> => {
  const info = await statfs(targetPath);
  const availableBytes = info.bsize * info.bavail;
  return availableBytes >= requiredBytes;
};

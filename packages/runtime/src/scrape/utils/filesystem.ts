import { mkdir, stat, statfs } from "node:fs/promises";
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

export const hasEnoughDiskSpace = async (targetPath: string, requiredBytes: number): Promise<boolean> => {
  const info = await statfs(targetPath);
  const availableBytes = info.bsize * info.bavail;
  return availableBytes >= requiredBytes;
};

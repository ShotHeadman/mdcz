import { stat } from "node:fs/promises";
import { extname } from "node:path";
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

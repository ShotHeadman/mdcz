import { mkdir, readdir, realpath, rename, stat, statfs } from "node:fs/promises";
import { dirname, extname, join, parse, resolve } from "node:path";

const DEFAULT_VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".avi",
  ".rmvb",
  ".wmv",
  ".mov",
  ".mkv",
  ".flv",
  ".ts",
  ".webm",
  ".iso",
  ".mpg",
  ".strm",
]);

export const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

export const imageContentTypeFromPath = (path: string): string => {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  return "image/jpeg";
};

const resolveDirectoryKey = async (dirPath: string): Promise<string> => {
  try {
    return await realpath(dirPath);
  } catch {
    return dirPath;
  }
};

const walkDirectory = async (dirPath: string, recursive: boolean, visitedDirs: Set<string>): Promise<string[]> => {
  const dirKey = await resolveDirectoryKey(dirPath);
  if (visitedDirs.has(dirKey)) {
    return [];
  }
  visitedDirs.add(dirKey);

  const entries = await readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (recursive) {
        files.push(...(await walkDirectory(absolutePath, true, visitedDirs)));
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
            files.push(...(await walkDirectory(absolutePath, true, visitedDirs)));
          }
          continue;
        }

        if (targetStats.isFile()) {
          files.push(absolutePath);
        }
      } catch {
        // Ignore broken/inaccessible symlink entries during scanning.
      }
    }
  }

  return files;
};

export const listFiles = async (dirPath: string, recursive = false): Promise<string[]> => {
  return walkDirectory(dirPath, recursive, new Set<string>());
};

export const listVideoFiles = async (
  dirPath: string,
  recursive = false,
  extensions: Set<string> = DEFAULT_VIDEO_EXTENSIONS,
): Promise<string[]> => {
  const files = await listFiles(dirPath, recursive);
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

export const moveFileSafely = async (sourcePath: string, targetPath: string): Promise<string> => {
  await ensureParentDirectory(targetPath);
  const resolved = await resolveAvailablePath(targetPath, sourcePath);

  await rename(sourcePath, resolved);
  return resolved;
};

export const renameFileSafely = async (filePath: string, nextBaseName: string): Promise<string> => {
  const parsed = parse(filePath);
  const nextPath = join(parsed.dir, `${nextBaseName}${parsed.ext}`);
  return moveFileSafely(filePath, nextPath);
};

export const hasEnoughDiskSpace = async (targetPath: string, requiredBytes: number): Promise<boolean> => {
  const info = await statfs(targetPath);
  const availableBytes = info.bsize * info.bavail;
  return availableBytes >= requiredBytes;
};

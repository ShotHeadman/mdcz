import { copyFile, lstat, mkdir, readdir, rm, stat, symlink, unlink } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { inspectStrmTarget } from "../scrape/utils/strm";
import { SUBTITLE_EXTENSIONS } from "../scrape/utils/subtitles";

export { applyAmazonPosters, lookupAmazonPoster, scanAmazonPosters } from "./amazonPoster";
export {
  applyBatchNfoTranslations,
  type BatchNfoTranslatorDependencies,
  scanBatchNfoTranslations,
} from "./batchNfoTranslator";

const DEFAULT_MEDIA_EXTENSIONS = new Set([
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

const normalizeExtension = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";
  return normalized.startsWith(".") ? normalized : `.${normalized}`;
};

const isSameOrSubPath = (candidate: string, parent: string): boolean => {
  const rel = relative(parent, candidate);
  return rel.length === 0 || (!rel.startsWith("..") && !isAbsolute(rel));
};

const shouldSkipFileName = (fileName: string): boolean => {
  const lower = fileName.toLowerCase();
  return (
    lower.startsWith(".") || lower.includes("trailer.") || lower.includes("trailers.") || lower.includes("theme_video.")
  );
};

const listAllFiles = async (sourceDir: string, excludedDir?: string, recursive = true): Promise<string[]> => {
  const files: string[] = [];
  const stack: string[] = [sourceDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) continue;

    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(currentDir, entry.name);
      const resolvedPath = resolve(absolutePath);

      if (entry.isDirectory()) {
        if (excludedDir && isSameOrSubPath(resolvedPath, excludedDir)) continue;
        if (recursive) stack.push(resolvedPath);
        continue;
      }

      if (entry.isFile() || entry.isSymbolicLink()) {
        files.push(resolvedPath);
      }
    }
  }

  return files;
};

type DestinationState = "missing" | "existing" | "broken_symlink";

const getDestinationState = async (path: string): Promise<DestinationState> => {
  try {
    const stats = await lstat(path);
    if (!stats.isSymbolicLink()) return "existing";

    try {
      await stat(path);
      return "existing";
    } catch {
      return "broken_symlink";
    }
  } catch {
    return "missing";
  }
};

export interface MissingNumberInput {
  prefix?: string;
  start: number;
  end: number;
  existing?: string[];
}

export interface MissingNumberResult {
  missing: string[];
  total: number;
}

export const findMissingNumbers = (input: MissingNumberInput): MissingNumberResult => {
  const from = Math.trunc(input.start);
  const to = Math.trunc(input.end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
    return { missing: [], total: 0 };
  }

  const prefix = input.prefix?.trim().toUpperCase() ?? "";
  const existingSet = new Set((input.existing ?? []).map((item) => item.trim().toUpperCase().replace(/[ _]/gu, "-")));
  const width = Math.max(String(Math.abs(from)).length, String(Math.abs(to)).length, 3);
  const missing: string[] = [];

  for (let current = from; current <= to; current += 1) {
    const value = `${prefix}${prefix ? "-" : ""}${String(current).padStart(width, "0")}`;
    if (!existingSet.has(value)) {
      missing.push(value);
    }
  }

  return { missing, total: missing.length };
};

export interface CreateSymlinkPayload {
  sourceDir: string;
  destDir: string;
  copyFiles?: boolean;
  dryRun?: boolean;
}

export interface SymlinkTaskResult {
  total: number;
  linked: number;
  copied: number;
  skipped: number;
  failed: number;
  planned: string[];
}

export class SymlinkServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const createSymlinks = async (payload: CreateSymlinkPayload): Promise<SymlinkTaskResult> => {
  const sourceInput = payload.sourceDir.trim();
  const destInput = payload.destDir.trim();
  if (!sourceInput || !destInput) {
    throw new SymlinkServiceError("VALIDATION_ERROR", "Source and destination directories are required");
  }

  const sourceDir = resolve(sourceInput);
  const destDir = resolve(destInput);
  if (sourceDir === destDir) {
    throw new SymlinkServiceError("VALIDATION_ERROR", "Source and destination directories must be different");
  }

  const sourceStats = await stat(sourceDir).catch(() => null);
  if (!sourceStats?.isDirectory()) {
    throw new SymlinkServiceError("SOURCE_NOT_FOUND", `Source directory does not exist: ${sourceDir}`);
  }

  if (!payload.dryRun) {
    await mkdir(destDir, { recursive: true });
  }

  const copyExtensions = new Set([".nfo", ".jpg", ".png", ...SUBTITLE_EXTENSIONS]);
  const result: SymlinkTaskResult = { total: 0, linked: 0, copied: 0, skipped: 0, failed: 0, planned: [] };
  const linkedSources = new Set<string>();

  for (const sourcePath of await listAllFiles(sourceDir, destDir)) {
    const fileName = sourcePath.slice(Math.max(sourcePath.lastIndexOf("/"), sourcePath.lastIndexOf("\\")) + 1);
    if (shouldSkipFileName(fileName)) continue;

    const extension = normalizeExtension(extname(fileName));
    if (!DEFAULT_MEDIA_EXTENSIONS.has(extension) && !copyExtensions.has(extension)) continue;

    result.total += 1;
    const destinationPath = join(destDir, relative(sourceDir, sourcePath));
    const destinationState = await getDestinationState(destinationPath);
    if (destinationState === "existing") {
      result.skipped += 1;
      continue;
    }

    result.planned.push(destinationPath);
    if (payload.dryRun) continue;

    await mkdir(dirname(destinationPath), { recursive: true });
    if (destinationState === "broken_symlink") {
      await unlink(destinationPath).catch(() => undefined);
    }

    const strmTarget = extension === ".strm" ? await inspectStrmTarget(sourcePath).catch(() => undefined) : undefined;
    if (strmTarget?.kind === "relative_path" || (copyExtensions.has(extension) && payload.copyFiles)) {
      try {
        await copyFile(sourcePath, destinationPath);
        result.copied += 1;
      } catch {
        result.failed += 1;
      }
      continue;
    }

    if (copyExtensions.has(extension)) {
      result.skipped += 1;
      continue;
    }

    const sourceKey = resolve(sourcePath);
    if (linkedSources.has(sourceKey)) {
      result.skipped += 1;
      continue;
    }
    linkedSources.add(sourceKey);

    try {
      await symlink(sourcePath, destinationPath);
      result.linked += 1;
    } catch {
      result.failed += 1;
    }
  }

  return result;
};

export interface CleanFilesInput {
  rootDir: string;
  extensions: string[];
  dryRun?: boolean;
  recursive?: boolean;
}

export interface CleanFilesResult {
  matched: number;
  deleted: number;
  files: string[];
}

export const cleanFilesByExtension = async (input: CleanFilesInput): Promise<CleanFilesResult> => {
  const rootDir = resolve(input.rootDir);
  const stats = await stat(rootDir);
  if (!stats.isDirectory()) {
    throw new Error(`Directory not found: ${rootDir}`);
  }

  const extensions = new Set(input.extensions.map(normalizeExtension).filter(Boolean));
  const files = (await listAllFiles(rootDir, undefined, input.recursive ?? true)).filter((file) =>
    extensions.has(normalizeExtension(extname(file))),
  );
  let deleted = 0;
  if (!input.dryRun) {
    for (const file of files) {
      await rm(file, { force: true });
      deleted += 1;
    }
  }

  return { matched: files.length, deleted, files };
};

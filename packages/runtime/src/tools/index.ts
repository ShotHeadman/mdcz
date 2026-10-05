import { copyFile, lstat, mkdir, readdir, stat, symlink, unlink } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { atomicWriteFile } from "@mdcz/media-store";
import { inspectStrmTarget, prepareMovedStrmContent } from "../scrape/utils/strm";
import { SUBTITLE_EXTENSIONS } from "../scrape/utils/subtitles";
import { runtimeLoggerService, toErrorMessage } from "../shared";

export * from "./AmazonJpImageService";
export { applyAmazonPosters, lookupAmazonPoster, scanAmazonPosters } from "./amazonPoster";
export {
  applyBatchNfoTranslations,
  type BatchNfoTranslatorApplyOptions,
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

    try {
      const strmTarget = extension === ".strm" ? await inspectStrmTarget(sourcePath) : undefined;
      if (extension === ".strm" && !strmTarget) throw new Error(`STRM file does not contain a target: ${sourcePath}`);
      if (copyExtensions.has(extension) && !payload.copyFiles) {
        result.skipped += 1;
        continue;
      }
      await mkdir(dirname(destinationPath), { recursive: true });
      if (destinationState === "broken_symlink") await unlink(destinationPath);
      if (strmTarget?.kind === "relative_path") {
        const content = await prepareMovedStrmContent(sourcePath, destinationPath);
        if (content === undefined) throw new Error(`Cannot relocate STRM target: ${sourcePath}`);
        await atomicWriteFile(destinationPath, content);
        result.copied += 1;
        continue;
      }
      if (copyExtensions.has(extension)) {
        await copyFile(sourcePath, destinationPath);
        result.copied += 1;
        continue;
      }
      const sourceKey = resolve(sourcePath);
      if (linkedSources.has(sourceKey)) {
        result.skipped += 1;
        continue;
      }
      await symlink(sourcePath, destinationPath);
      linkedSources.add(sourceKey);
      result.linked += 1;
    } catch (error) {
      result.failed += 1;
      // Windows refuses unprivileged symlinks without Developer Mode; surface why each file failed.
      runtimeLoggerService
        .getLogger("SymlinkTool")
        .warn(`Failed to link ${sourcePath} -> ${destinationPath}: ${toErrorMessage(error)}`);
    }
  }

  return result;
};

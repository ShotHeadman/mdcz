import { copyFile, lstat, mkdir, readdir, stat, symlink, unlink } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

import type { SignalService } from "@main/services/SignalService";
import { toErrorMessage } from "@main/utils/common";
import { inspectStrmTarget } from "@main/utils/strm";
import { SUBTITLE_EXTENSIONS } from "@main/utils/subtitles";

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
  if (!normalized) {
    return "";
  }
  return normalized.startsWith(".") ? normalized : `.${normalized}`;
};

const isSameOrSubPath = (candidate: string, parent: string): boolean => {
  const rel = relative(parent, candidate);
  return rel.length === 0 || (!rel.startsWith("..") && !isAbsolute(rel));
};

const shouldSkipFileName = (fileName: string): boolean => {
  const lower = fileName.toLowerCase();
  if (lower.startsWith(".")) {
    return true;
  }
  if (lower.includes("trailer.") || lower.includes("trailers.")) {
    return true;
  }
  if (lower.includes("theme_video.")) {
    return true;
  }
  return false;
};

const listAllFiles = async (sourceDir: string, excludedDir: string): Promise<string[]> => {
  const files: string[] = [];
  const stack: string[] = [sourceDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }

    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(currentDir, entry.name);
      const resolvedPath = resolve(absolutePath);

      if (entry.isDirectory()) {
        if (isSameOrSubPath(resolvedPath, excludedDir)) {
          continue;
        }
        stack.push(resolvedPath);
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
    if (!stats.isSymbolicLink()) {
      return "existing";
    }

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
}

interface PreparedSymlinkTask {
  sourceDir: string;
  destDir: string;
  copyFiles: boolean;
}

export interface SymlinkTaskResult {
  total: number;
  linked: number;
  copied: number;
  skipped: number;
  failed: number;
}

export class SymlinkServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface SymlinkServiceDependencies {
  signalService: SignalService;
}

export class SymlinkService {
  constructor(private readonly deps: SymlinkServiceDependencies) {}

  async prepare(payload: CreateSymlinkPayload): Promise<PreparedSymlinkTask> {
    const sourceInput = payload.sourceDir.trim();
    const destInput = payload.destDir.trim();
    if (!sourceInput || !destInput) {
      throw new SymlinkServiceError("VALIDATION_ERROR", "Source and destination directories are required");
    }

    const sourceDir = resolve(sourceInput);
    const destDir = resolve(destInput);
    const copyFiles = Boolean(payload.copyFiles);

    if (sourceDir === destDir) {
      throw new SymlinkServiceError("VALIDATION_ERROR", "Source and destination directories must be different");
    }

    const sourceStats = await stat(sourceDir).catch(() => null);
    if (!sourceStats || !sourceStats.isDirectory()) {
      throw new SymlinkServiceError("SOURCE_NOT_FOUND", `Source directory does not exist: ${sourceDir}`);
    }

    await mkdir(destDir, { recursive: true });

    return {
      sourceDir,
      destDir,
      copyFiles,
    };
  }

  async run(payload: CreateSymlinkPayload): Promise<SymlinkTaskResult> {
    return this.runPrepared(await this.prepare(payload));
  }

  async runPrepared({ sourceDir, destDir, copyFiles }: PreparedSymlinkTask): Promise<SymlinkTaskResult> {
    const copyExtensions = new Set([".nfo", ".jpg", ".png", ...SUBTITLE_EXTENSIONS]);

    this.deps.signalService.showLogText("Starting symlink task");
    this.deps.signalService.showLogText(`Symlink source: ${sourceDir}`);
    this.deps.signalService.showLogText(`Symlink destination: ${destDir}`);

    const result: SymlinkTaskResult = {
      total: 0,
      linked: 0,
      copied: 0,
      skipped: 0,
      failed: 0,
    };
    const linkedSources = new Set<string>();

    const files = await listAllFiles(sourceDir, destDir);
    for (const sourcePath of files) {
      const fileName = sourcePath.slice(Math.max(sourcePath.lastIndexOf("/"), sourcePath.lastIndexOf("\\")) + 1);
      if (shouldSkipFileName(fileName)) {
        continue;
      }

      const extension = normalizeExtension(extname(fileName));
      if (!DEFAULT_MEDIA_EXTENSIONS.has(extension) && !copyExtensions.has(extension)) {
        continue;
      }

      result.total += 1;

      const relativePath = relative(sourceDir, sourcePath);
      const destinationPath = join(destDir, relativePath);
      await mkdir(dirname(destinationPath), { recursive: true });

      const destinationState = await getDestinationState(destinationPath);
      if (destinationState === "existing") {
        this.deps.signalService.showLogText(`Skipped existing target: ${sourcePath}`);
        result.skipped += 1;
        continue;
      }

      if (destinationState === "broken_symlink") {
        await unlink(destinationPath).catch(() => undefined);
        this.deps.signalService.showLogText(`Removed broken symlink: ${destinationPath}`);
      }

      const strmTarget = extension === ".strm" ? await inspectStrmTarget(sourcePath).catch(() => undefined) : undefined;
      if (strmTarget?.kind === "relative_path") {
        try {
          await copyFile(sourcePath, destinationPath);
          this.deps.signalService.showLogText(`Copied relative STRM file: ${sourcePath}`);
          result.copied += 1;
        } catch (error) {
          result.failed += 1;
          const message = toErrorMessage(error);
          this.deps.signalService.showLogText(`Failed to copy relative STRM file: ${sourcePath}. ${message}`, "warn");
        }
        continue;
      }

      if (copyExtensions.has(extension)) {
        if (!copyFiles) {
          result.skipped += 1;
          continue;
        }

        try {
          await copyFile(sourcePath, destinationPath);
          this.deps.signalService.showLogText(`Copied sidecar asset: ${sourcePath}`);
          result.copied += 1;
        } catch (error) {
          result.failed += 1;
          const message = toErrorMessage(error);
          this.deps.signalService.showLogText(`Failed to copy sidecar asset: ${sourcePath}. ${message}`, "warn");
        }
        continue;
      }

      const sourceKey = resolve(sourcePath);
      if (linkedSources.has(sourceKey)) {
        this.deps.signalService.showLogText(`Skipped duplicate source: ${sourcePath}`);
        result.skipped += 1;
        continue;
      }
      linkedSources.add(sourceKey);

      try {
        await symlink(sourcePath, destinationPath);
        this.deps.signalService.showLogText(`Created symlink: ${sourcePath}`);
        result.linked += 1;
      } catch (error) {
        result.failed += 1;
        const message = toErrorMessage(error);
        this.deps.signalService.showLogText(`Failed to create symlink: ${sourcePath}. ${message}`, "warn");
      }
    }

    this.deps.signalService.showLogText(
      `Symlink task completed. Total: ${result.total}, Linked: ${result.linked}, Copied: ${result.copied}, Skipped: ${result.skipped}, Failed: ${result.failed}`,
    );

    return result;
  }
}

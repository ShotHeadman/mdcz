import { readdir, rm, stat } from "node:fs/promises";
import { dirname, join, normalize, parse, resolve } from "node:path";

import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import {
  ensureParentDirectory,
  hasEnoughDiskSpace,
  listVideoFiles,
  moveFileSafely,
  resolveAvailablePath,
} from "@main/utils/file";
import { buildSafePath, sanitizePathSegment } from "@main/utils/path";
import type { CrawlerData, FileInfo } from "@shared/types";

export interface OrganizePlan {
  outputDir: string;
  targetVideoPath: string;
  nfoPath: string;
}

interface ResolveOutputPlanOptions {
  createDirectories?: boolean;
}

const UNCENSORED_NUMBER_PATTERNS = [/^FC2-\d+/iu, /^HEYZO-\d+/iu, /^(?:1PON|10MU|CARIB|PACO|MURA|KIN8)[-_]?\d+/iu];

const UMR_HINTS = ["umr", "破解", "universal media record"];
const LEAK_HINTS = ["流出", "leak"];

const pickActorFolder = (config: Configuration, actors: string[]): string => {
  const cleaned = actors.map((actor) => actor.trim()).filter((actor) => actor.length > 0);
  if (cleaned.length === 0) {
    return "Unknown";
  }

  const max = Math.max(1, config.naming.actorNameMax);
  const selected = cleaned.slice(0, max);
  if (cleaned.length > max) {
    selected.push(config.naming.actorNameMore);
  }

  return selected.join(" ");
};

const normalizeMarker = (value: string): string => value.trim();

const appendMarker = (markers: string[], value: string): void => {
  const marker = normalizeMarker(value);
  if (!marker || markers.includes(marker)) {
    return;
  }
  markers.push(marker);
};

const includesHint = (source: string, hints: string[]): boolean => {
  const text = source.toLowerCase();
  return hints.some((hint) => text.includes(hint));
};

const isLikelyUncensoredNumber = (number: string): boolean => {
  const normalized = number.trim().toUpperCase();
  if (!normalized) {
    return false;
  }

  return UNCENSORED_NUMBER_PATTERNS.some((pattern) => pattern.test(normalized));
};

const buildNumberWithNamingMarkers = (fileInfo: FileInfo, data: CrawlerData, config: Configuration): string => {
  const baseNumber = data.number.trim();
  if (!baseNumber) {
    return data.number;
  }

  const markers: string[] = [];
  if (fileInfo.isSubtitled) {
    appendMarker(markers, config.naming.cnwordStyle);
  }

  const textProbe = [data.title, data.title_zh, ...(data.genres ?? [])]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (includesHint(textProbe, UMR_HINTS)) {
    appendMarker(markers, config.naming.umrStyle);
  }

  if (includesHint(textProbe, LEAK_HINTS)) {
    appendMarker(markers, config.naming.leakStyle);
  }

  if (isLikelyUncensoredNumber(baseNumber)) {
    appendMarker(markers, config.naming.uncensoredStyle);
  } else {
    appendMarker(markers, config.naming.censoredStyle);
  }

  return `${baseNumber}${markers.join("")}`;
};

const formatReleaseDateByRule = (releaseDate: string | undefined, rule: string): string | undefined => {
  if (!releaseDate) {
    return undefined;
  }

  const normalized = releaseDate.trim();
  if (!normalized) {
    return undefined;
  }

  const match = normalized.match(/^(\d{4})[-/.]?(\d{1,2})[-/.]?(\d{1,2})/u);
  if (!match) {
    return normalized;
  }

  const year = match[1];
  const month = match[2].padStart(2, "0");
  const day = match[3].padStart(2, "0");
  const template = rule.trim() || "YYYY-MM-DD";

  return template.replaceAll("YYYY", year).replaceAll("MM", month).replaceAll("DD", day);
};

const truncateSegment = (value: string, maxLength: number): string => {
  const limit = Math.max(1, Math.trunc(maxLength));
  if (value.length <= limit) {
    return value;
  }
  return value.slice(0, limit).trim();
};

const truncatePathSegments = (value: string, maxLength: number): string => {
  return value
    .split(/[\\/]+/u)
    .map((segment) => truncateSegment(segment, maxLength))
    .filter((segment) => segment.length > 0)
    .join("/");
};

const isGeneratedSidecarVideo = (filePath: string): boolean => parse(filePath).name.toLowerCase() === "trailer";

export class FileOrganizer {
  private readonly logger = loggerService.getLogger("FileOrganizer");

  plan(fileInfo: FileInfo, data: CrawlerData, config: Configuration): OrganizePlan {
    const title = data.title_zh?.trim() || data.title;
    const actorFolder = pickActorFolder(config, data.actors ?? []);
    const styledNumber = buildNumberWithNamingMarkers(fileInfo, data, config);
    const formattedReleaseDate = formatReleaseDateByRule(data.release_date, config.naming.releaseRule);
    const templateData = {
      title,
      number: styledNumber,
      actor: actorFolder,
      date: formattedReleaseDate,
      studio: data.studio,
    };

    const sourceVideo = parse(fileInfo.filePath);
    const outputDir = config.behavior.successFileMove
      ? join(
          this.resolveBaseOutput(fileInfo, config),
          truncatePathSegments(buildSafePath(config.naming.folderTemplate, templateData), config.naming.folderNameMax),
        )
      : sourceVideo.dir;

    const fileBaseName = truncateSegment(
      sanitizePathSegment(buildSafePath(config.naming.fileTemplate, templateData)) || styledNumber,
      config.naming.fileNameMax,
    );
    const targetVideoFileName = config.behavior.successFileRename
      ? `${fileBaseName}${fileInfo.extension}`
      : sourceVideo.base;
    const targetVideoPath = join(outputDir, targetVideoFileName);
    const nfoPath = join(outputDir, `${parse(targetVideoPath).name}.nfo`);

    return {
      outputDir,
      targetVideoPath,
      nfoPath,
    };
  }

  async ensureOutputReady(plan: OrganizePlan, sourceFilePath: string): Promise<OrganizePlan> {
    return this.resolveOutputPlan(plan, sourceFilePath, { createDirectories: true });
  }

  async resolveOutputPlan(
    plan: OrganizePlan,
    sourceFilePath: string,
    options: ResolveOutputPlanOptions = {},
  ): Promise<OrganizePlan> {
    if (options.createDirectories) {
      await ensureParentDirectory(plan.targetVideoPath);
    }

    const outputRoot = dirname(plan.targetVideoPath);
    const sourceDir = resolve(dirname(sourceFilePath));
    const sameDirectoryOutput = sourceDir === resolve(outputRoot);

    if (sameDirectoryOutput) {
      const videoFiles = await listVideoFiles(sourceDir, false);
      const otherVideos = videoFiles.filter(
        (filePath) => resolve(filePath) !== resolve(sourceFilePath) && !isGeneratedSidecarVideo(filePath),
      );
      if (otherVideos.length > 0) {
        throw new Error("成功后不移动文件时，仅支持源目录内存在单个视频文件");
      }
    }

    if (!sameDirectoryOutput) {
      const stats = await stat(sourceFilePath);
      const diskCheckPath = options.createDirectories ? outputRoot : await this.resolveExistingDirectory(outputRoot);
      const ok = await hasEnoughDiskSpace(diskCheckPath, stats.size);
      if (!ok) {
        throw new Error(`Not enough disk space to move file to ${outputRoot}`);
      }
    }

    const targetVideoPath = await resolveAvailablePath(plan.targetVideoPath, sourceFilePath);
    const outputDir = dirname(targetVideoPath);
    const nfoPath = join(outputDir, `${parse(targetVideoPath).name}.nfo`);

    return {
      outputDir,
      targetVideoPath,
      nfoPath,
    };
  }

  async organizeVideo(fileInfo: FileInfo, plan: OrganizePlan, config: Configuration): Promise<string> {
    if (!config.behavior.successFileMove) {
      if (!config.behavior.successFileRename) {
        this.logger.info(`successFileMove disabled; leaving file at ${fileInfo.filePath}`);
        return fileInfo.filePath;
      }

      return moveFileSafely(fileInfo.filePath, plan.targetVideoPath);
    }

    const sourceDir = dirname(fileInfo.filePath);
    const result = await moveFileSafely(fileInfo.filePath, plan.targetVideoPath);

    if (config.behavior.deleteEmptyFolder) {
      const mediaRoot = resolve(config.paths.mediaPath.trim() || dirname(fileInfo.filePath));
      await this.tryDeleteEmptyAncestors(sourceDir, mediaRoot);
    }

    return result;
  }

  async moveToFailedFolder(fileInfo: FileInfo, config: Configuration): Promise<void> {
    const mediaRoot = config.paths.mediaPath.trim();
    const base = mediaRoot.length > 0 ? mediaRoot : dirname(fileInfo.filePath);
    const failedDir = join(base, config.paths.failedOutputFolder);
    const targetPath = join(failedDir, fileInfo.fileName + fileInfo.extension);

    await ensureParentDirectory(targetPath);
    await moveFileSafely(fileInfo.filePath, targetPath);
    this.logger.info(`Moved failed file to ${failedDir}: ${fileInfo.fileName}`);
  }

  private resolveBaseOutput(fileInfo: FileInfo, config: Configuration): string {
    const mediaRoot = config.paths.mediaPath.trim();
    const base = mediaRoot.length > 0 ? mediaRoot : dirname(fileInfo.filePath);
    return join(base, config.paths.successOutputFolder);
  }

  private async resolveExistingDirectory(dirPath: string): Promise<string> {
    let current = resolve(dirPath);

    while (true) {
      try {
        const info = await stat(current);
        if (info.isDirectory()) {
          return current;
        }
      } catch {
        // Keep walking up to the nearest existing directory.
      }

      const parent = dirname(current);
      if (parent === current) {
        return current;
      }
      current = parent;
    }
  }

  /**
   * Recursively delete empty directories from `dirPath` up to (but not including) `stopAt`.
   */
  private async tryDeleteEmptyAncestors(dirPath: string, stopAt: string): Promise<void> {
    const normalizedStop = normalize(resolve(stopAt));
    let current = normalize(resolve(dirPath));

    while (current.length > normalizedStop.length && current.startsWith(normalizedStop)) {
      try {
        const entries = await readdir(current);
        if (entries.length > 0) break;
        await rm(current, { recursive: true });
        this.logger.info(`Deleted empty folder: ${current}`);
        current = dirname(current);
      } catch {
        break;
      }
    }
  }
}

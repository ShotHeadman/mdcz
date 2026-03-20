import { readdir, rm, stat } from "node:fs/promises";
import { dirname, join, normalize, parse, resolve } from "node:path";

import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import {
  ensureParentDirectory,
  hasEnoughDiskSpace,
  listVideoFiles,
  moveFileSafely,
  pathExists,
} from "@main/utils/file";
import { classifyMovie } from "@main/utils/movieClassification";
import { parseFileInfo } from "@main/utils/number";
import { buildSafePath, sanitizePathSegment } from "@main/utils/path";
import { resolveFileInfoSubtitleTag } from "@main/utils/subtitles";
import type { CrawlerData, FileInfo } from "@shared/types";
import { isGeneratedSidecarVideo } from "./generatedSidecarVideos";
import { buildSubtitleSidecarTargetPath, findSubtitleSidecars, type SubtitleSidecarMatch } from "./subtitleSidecars";

export interface OrganizePlan {
  outputDir: string;
  targetVideoPath: string;
  nfoPath: string;
  subtitleSidecars?: SubtitleSidecarMatch[];
}

interface ResolveOutputPlanOptions {
  createDirectories?: boolean;
}

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

const isBareNumericPartSuffix = (suffix: string): boolean => /^[-_.\s][1-9]$/u.test(suffix.trimEnd());

const formatPartSuffix = (fileInfo: FileInfo, config: Configuration): string => {
  if (!fileInfo.part) {
    return "";
  }

  if (!isBareNumericPartSuffix(fileInfo.part.suffix)) {
    return fileInfo.part.suffix;
  }

  return `-${config.naming.partStyle}${fileInfo.part.number}`;
};

const buildNumberWithNamingMarkers = (fileInfo: FileInfo, data: CrawlerData, config: Configuration): string => {
  const baseNumber = data.number.trim();
  if (!baseNumber) {
    return data.number;
  }

  const classification = classifyMovie(fileInfo, data);
  const markers: string[] = [];
  if (resolveFileInfoSubtitleTag(fileInfo) === "中文字幕") {
    appendMarker(markers, config.naming.cnwordStyle);
  }

  if (classification.umr) {
    appendMarker(markers, config.naming.umrStyle);
  }

  if (classification.leak) {
    appendMarker(markers, config.naming.leakStyle);
  }

  if (classification.uncensored) {
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

export class FileOrganizer {
  private readonly logger = loggerService.getLogger("FileOrganizer");

  plan(fileInfo: FileInfo, data: CrawlerData, config: Configuration): OrganizePlan {
    const title = data.title_zh?.trim() || data.title;
    const actorFolder = pickActorFolder(config, data.actors ?? []);
    const styledNumber = buildNumberWithNamingMarkers(fileInfo, data, config);
    const partSuffix = formatPartSuffix(fileInfo, config);
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
    const nfoBaseName = fileInfo.part ? fileBaseName : parse(sourceVideo.base).name;
    const targetVideoFileName = config.behavior.successFileRename
      ? `${fileBaseName}${partSuffix}${fileInfo.extension}`
      : sourceVideo.base;
    const targetVideoPath = join(outputDir, targetVideoFileName);
    const nfoPath = join(outputDir, `${config.behavior.successFileRename ? fileBaseName : nfoBaseName}.nfo`);

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
      const sourceFileInfo = parseFileInfo(sourceFilePath);
      const videoFiles = await listVideoFiles(sourceDir, false);
      const otherVideos = videoFiles.filter((filePath) => {
        if (resolve(filePath) === resolve(sourceFilePath) || isGeneratedSidecarVideo(filePath)) {
          return false;
        }

        const siblingFileInfo = parseFileInfo(filePath);
        if (sourceFileInfo.number === siblingFileInfo.number && (sourceFileInfo.part || siblingFileInfo.part)) {
          return false;
        }

        return true;
      });
      if (otherVideos.length > 0) {
        this.logger.warn(`Cannot organize in place because multiple video files exist in ${sourceDir}`);
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

    const resolvedPlan = await this.resolveBundledTargetPaths({
      sourceVideoPath: sourceFilePath,
      targetVideoPath: plan.targetVideoPath,
      nfoPath: plan.nfoPath,
      ignoreExistingNfoAtTarget: sameDirectoryOutput,
      subtitleSidecars: plan.subtitleSidecars,
    });

    return {
      outputDir: dirname(resolvedPlan.targetVideoPath),
      targetVideoPath: resolvedPlan.targetVideoPath,
      nfoPath: resolvedPlan.nfoPath ?? plan.nfoPath,
      subtitleSidecars: resolvedPlan.subtitleSidecars,
    };
  }

  async organizeVideo(fileInfo: FileInfo, plan: OrganizePlan, config: Configuration): Promise<string> {
    if (!config.behavior.successFileMove) {
      if (!config.behavior.successFileRename) {
        this.logger.info(`successFileMove disabled; leaving file at ${fileInfo.filePath}`);
        return fileInfo.filePath;
      }

      const renamedPath = await this.moveBundledMedia(fileInfo.filePath, plan.targetVideoPath, plan.subtitleSidecars);
      return renamedPath;
    }

    const sourceDir = dirname(fileInfo.filePath);
    const result = await this.moveBundledMedia(fileInfo.filePath, plan.targetVideoPath, plan.subtitleSidecars);

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
    const resolvedPaths = await this.resolveBundledTargetPaths({
      sourceVideoPath: fileInfo.filePath,
      targetVideoPath: join(failedDir, fileInfo.fileName + fileInfo.extension),
    });

    await ensureParentDirectory(resolvedPaths.targetVideoPath);
    await this.moveBundledMedia(fileInfo.filePath, resolvedPaths.targetVideoPath, resolvedPaths.subtitleSidecars);
    this.logger.info(`Moved failed file to ${failedDir}: ${fileInfo.fileName}`);
  }

  private async moveBundledMedia(
    sourceVideoPath: string,
    targetVideoPath: string,
    subtitleSidecars?: SubtitleSidecarMatch[],
  ): Promise<string> {
    const resolvedSubtitleSidecars = subtitleSidecars ?? (await findSubtitleSidecars(sourceVideoPath));
    const movedArtifacts: Array<{ sourcePath: string; targetPath: string }> = [];
    let movedVideoPath: string | undefined;

    try {
      movedVideoPath = await moveFileSafely(sourceVideoPath, targetVideoPath);

      for (const subtitleSidecar of resolvedSubtitleSidecars) {
        const targetSubtitlePath = buildSubtitleSidecarTargetPath(subtitleSidecar, movedVideoPath);
        const movedSubtitlePath = await moveFileSafely(subtitleSidecar.path, targetSubtitlePath);
        movedArtifacts.push({
          sourcePath: subtitleSidecar.path,
          targetPath: movedSubtitlePath,
        });
        this.logger.info(`Moved subtitle sidecar to ${movedSubtitlePath}`);
      }

      return movedVideoPath;
    } catch (error) {
      const rollbackErrors: string[] = [];

      for (const artifact of movedArtifacts.reverse()) {
        try {
          await moveFileSafely(artifact.targetPath, artifact.sourcePath);
        } catch (rollbackError) {
          const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
          rollbackErrors.push(`subtitle ${artifact.targetPath}: ${rollbackMessage}`);
        }
      }

      if (movedVideoPath && (await pathExists(movedVideoPath))) {
        try {
          await moveFileSafely(movedVideoPath, sourceVideoPath);
        } catch (rollbackError) {
          const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
          rollbackErrors.push(`video ${movedVideoPath}: ${rollbackMessage}`);
        }
      }

      const message = error instanceof Error ? error.message : String(error);
      if (rollbackErrors.length > 0) {
        throw new Error(`Failed to move bundled media: ${message}. Rollback failed: ${rollbackErrors.join("; ")}`);
      }

      throw new Error(`Failed to move bundled media: ${message}`);
    }
  }

  private async resolveBundledTargetPaths(options: {
    sourceVideoPath: string;
    targetVideoPath: string;
    nfoPath?: string;
    ignoreExistingNfoAtTarget?: boolean;
    subtitleSidecars?: SubtitleSidecarMatch[];
  }): Promise<{
    targetVideoPath: string;
    nfoPath?: string;
    subtitleSidecars: SubtitleSidecarMatch[];
  }> {
    const subtitleSidecars = options.subtitleSidecars ?? (await findSubtitleSidecars(options.sourceVideoPath));
    const ignoredExistingPaths = new Set<string>([
      resolve(options.sourceVideoPath),
      ...subtitleSidecars.map((subtitleSidecar) => resolve(subtitleSidecar.path)),
    ]);
    if (options.ignoreExistingNfoAtTarget && options.nfoPath) {
      ignoredExistingPaths.add(resolve(options.nfoPath));
    }

    const parsedTargetVideo = parse(options.targetVideoPath);
    const parsedNfo = options.nfoPath ? parse(options.nfoPath) : undefined;
    const nfoTracksVideoBase = parsedNfo ? parsedNfo.name === parsedTargetVideo.name : false;
    let collisionSuffix = 0;

    while (true) {
      const candidateBaseName =
        collisionSuffix === 0 ? parsedTargetVideo.name : `${parsedTargetVideo.name} (${collisionSuffix})`;
      const candidateVideoPath = join(parsedTargetVideo.dir, `${candidateBaseName}${parsedTargetVideo.ext}`);
      const candidateNfoPath = parsedNfo
        ? join(parsedNfo.dir, `${nfoTracksVideoBase ? candidateBaseName : parsedNfo.name}${parsedNfo.ext}`)
        : undefined;
      const candidatePaths = [
        candidateVideoPath,
        ...subtitleSidecars.map((subtitleSidecar) =>
          buildSubtitleSidecarTargetPath(subtitleSidecar, candidateVideoPath),
        ),
        ...(candidateNfoPath ? [candidateNfoPath] : []),
      ];
      const hasCollision = (
        await Promise.all(candidatePaths.map((path) => this.hasTargetCollision(path, ignoredExistingPaths)))
      ).some(Boolean);

      if (!hasCollision) {
        return {
          targetVideoPath: candidateVideoPath,
          nfoPath: candidateNfoPath,
          subtitleSidecars,
        };
      }

      collisionSuffix += 1;
    }
  }

  private async hasTargetCollision(targetPath: string, ignoredExistingPaths: Set<string>): Promise<boolean> {
    if (!(await pathExists(targetPath))) {
      return false;
    }

    return !ignoredExistingPaths.has(resolve(targetPath));
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

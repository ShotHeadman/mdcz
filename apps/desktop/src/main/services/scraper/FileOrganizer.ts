import { stat } from "node:fs/promises";
import { dirname, join, parse, resolve, sep } from "node:path";

import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import { ensureParentDirectory, hasEnoughDiskSpace, listVideoFiles } from "@main/utils/file";
import { parseFileInfo } from "@main/utils/number";
import type { CrawlerData, FileInfo, NamingPreviewItem, NfoLocalState } from "@mdcz/shared/types";
import type { ScrapeExecutionMode } from "./FileScraper";
import { isGeneratedSidecarVideo, type SubtitleSidecarMatch } from "./media";
import { FileMover } from "./organize/FileMover";
import { NamingEngine } from "./organize/NamingEngine";
import { PathPlanner } from "./organize/PathPlanner";
import { SidecarResolver } from "./organize/SidecarResolver";

export interface OrganizePlan {
  outputDir: string;
  targetVideoPath: string;
  nfoPath: string;
  subtitleSidecars?: SubtitleSidecarMatch[];
}

interface ResolveOutputPlanOptions {
  createDirectories?: boolean;
}

interface PlanOptions {
  executionMode?: ScrapeExecutionMode;
}

export class FileOrganizer {
  private readonly logger = loggerService.getLogger("FileOrganizer");

  private readonly sidecarResolver = new SidecarResolver();

  private readonly namingEngine = new NamingEngine();

  private readonly pathPlanner = new PathPlanner(this.sidecarResolver);

  private readonly fileMover = new FileMover(this.logger, this.sidecarResolver);

  plan(
    fileInfo: FileInfo,
    data: CrawlerData,
    config: Configuration,
    localState?: NfoLocalState,
    options: PlanOptions = {},
  ): OrganizePlan {
    const sourceVideo = parse(fileInfo.filePath);
    const layout = this.namingEngine.buildLayout(fileInfo, data, config, localState);

    let outputDir: string;
    if (config.behavior.successFileMove) {
      const baseOutput = this.resolveBaseOutput(fileInfo, config, options);
      const sourceDir = resolve(sourceVideo.dir);
      const isAlreadyInOutput =
        options.executionMode === "single"
          ? this.isSingleModeOutputDirectory(sourceDir, layout.folderRelativePath)
          : sourceDir.startsWith(resolve(baseOutput) + sep);
      outputDir = isAlreadyInOutput ? sourceDir : join(baseOutput, layout.folderRelativePath);
    } else {
      outputDir = sourceVideo.dir;
    }

    const targetVideoPath = join(outputDir, layout.targetVideoFileName);
    const nfoPath = join(outputDir, layout.nfoFileName);

    return {
      outputDir,
      targetVideoPath,
      nfoPath,
    };
  }

  buildNamingPreview(config: Configuration): NamingPreviewItem[] {
    return this.namingEngine.buildPreview(config);
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
      const diskCheckPath = options.createDirectories
        ? outputRoot
        : await this.pathPlanner.resolveExistingDirectory(outputRoot);
      const ok = await hasEnoughDiskSpace(diskCheckPath, stats.size);
      if (!ok) {
        throw new Error(`Not enough disk space to move file to ${outputRoot}`);
      }
    }

    const resolvedPlan = await this.pathPlanner.resolveBundledTargetPaths({
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

      const renamedPath = await this.fileMover.moveBundledMedia(fileInfo.filePath, plan.targetVideoPath, {
        subtitleSidecars: plan.subtitleSidecars,
        sharedMovieBaseName: parse(plan.nfoPath).name,
      });
      return renamedPath;
    }

    const sourceDir = dirname(fileInfo.filePath);
    const result = await this.fileMover.moveBundledMedia(fileInfo.filePath, plan.targetVideoPath, {
      subtitleSidecars: plan.subtitleSidecars,
      sharedMovieBaseName: parse(plan.nfoPath).name,
    });

    if (config.behavior.deleteEmptyFolder) {
      const mediaRoot = resolve(config.paths.mediaPath.trim() || dirname(fileInfo.filePath));
      await this.fileMover.cleanupEmptyAncestors(sourceDir, mediaRoot);
    }

    return result;
  }

  async moveToFailedFolder(fileInfo: FileInfo, config: Configuration): Promise<string> {
    const mediaRoot = config.paths.mediaPath.trim();
    const base = mediaRoot.length > 0 ? mediaRoot : dirname(fileInfo.filePath);
    const failedDir = resolve(base, config.paths.failedOutputFolder.trim());
    const resolvedPaths = await this.pathPlanner.resolveBundledTargetPaths({
      sourceVideoPath: fileInfo.filePath,
      targetVideoPath: join(failedDir, fileInfo.fileName + fileInfo.extension),
    });

    await ensureParentDirectory(resolvedPaths.targetVideoPath);
    const movedPath = await this.fileMover.moveBundledMedia(fileInfo.filePath, resolvedPaths.targetVideoPath, {
      subtitleSidecars: resolvedPaths.subtitleSidecars,
      sharedMovieBaseName: fileInfo.number,
    });
    this.logger.info(`Moved failed file to ${failedDir}: ${fileInfo.fileName}`);
    return movedPath;
  }

  private resolveBaseOutput(fileInfo: FileInfo, config: Configuration, options: PlanOptions): string {
    if (options.executionMode === "single") {
      return dirname(fileInfo.filePath);
    }

    const mediaRoot = config.paths.mediaPath.trim();
    const base = mediaRoot.length > 0 ? mediaRoot : dirname(fileInfo.filePath);
    return resolve(base, config.paths.successOutputFolder.trim());
  }

  private isSingleModeOutputDirectory(sourceDir: string, folderRelativePath: string): boolean {
    const relativeSegments = folderRelativePath.split(/[\\/]+/u).filter((segment) => segment.length > 0);
    if (relativeSegments.length === 0) {
      return true;
    }

    const sourceSegments = resolve(sourceDir)
      .split(/[\\/]+/u)
      .filter((segment) => segment.length > 0);
    if (relativeSegments.length > sourceSegments.length) {
      return false;
    }

    const startIndex = sourceSegments.length - relativeSegments.length;
    return relativeSegments.every((segment, index) => {
      const sourceSegment = sourceSegments[startIndex + index];
      return process.platform === "win32"
        ? sourceSegment.toLowerCase() === segment.toLowerCase()
        : sourceSegment === segment;
    });
  }
}

export const fileOrganizer = new FileOrganizer();

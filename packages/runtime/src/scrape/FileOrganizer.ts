import { stat } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

import type { Configuration } from "@mdcz/shared/config";
import type { CrawlerData, FileInfo, NamingPreviewItem, NfoLocalState } from "@mdcz/shared/types";
import { noopRuntimeLogger, type RuntimeLogger } from "../shared";
import { isGeneratedSidecarVideo, type SubtitleSidecarMatch } from "./media";
import { FileMover } from "./organize/FileMover";
import { NamingEngine } from "./organize/NamingEngine";
import { PathPlanner } from "./organize/PathPlanner";
import { SidecarResolver } from "./organize/SidecarResolver";
import { ensureParentDirectory, hasEnoughDiskSpace, listVideoFiles } from "./utils/filesystem";
import { parseFileInfo } from "./utils/number";
import { inspectStrmTarget, isStrmFile, writeStrmTarget } from "./utils/strm";

export interface OrganizePlan {
  outputDir: string;
  metadataDir?: string;
  targetVideoPath: string;
  nfoPath: string;
  strmPath?: string;
  subtitleSidecars?: SubtitleSidecarMatch[];
}

export const resolveMetadataOutputDir = (plan: OrganizePlan): string => plan.metadataDir ?? plan.outputDir;

interface ResolveOutputPlanOptions {
  createDirectories?: boolean;
}

interface PlanOptions {
  executionMode?: ScrapeExecutionMode;
}

export type ScrapeExecutionMode = "single" | "batch";

export class FileOrganizer {
  private readonly logger: RuntimeLogger;

  private readonly sidecarResolver = new SidecarResolver();

  private readonly namingEngine = new NamingEngine();

  private readonly pathPlanner = new PathPlanner(this.sidecarResolver);

  private readonly fileMover: FileMover;

  constructor(logger: RuntimeLogger = noopRuntimeLogger) {
    this.logger = logger;
    this.fileMover = new FileMover(this.logger, this.sidecarResolver);
  }

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
    const metadataDir = this.resolveMetadataDir(outputDir, config);
    const nfoPath = join(metadataDir, layout.nfoFileName);
    const strmPath = metadataDir === outputDir ? undefined : join(metadataDir, `${parse(targetVideoPath).name}.strm`);

    return {
      outputDir,
      metadataDir,
      targetVideoPath,
      nfoPath,
      strmPath,
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
      await ensureParentDirectory(plan.nfoPath);
      if (plan.strmPath) {
        await ensureParentDirectory(plan.strmPath);
      }
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

    const metadataDir = plan.metadataDir ?? dirname(resolvedPlan.nfoPath ?? plan.nfoPath);
    return {
      outputDir: dirname(resolvedPlan.targetVideoPath),
      metadataDir,
      targetVideoPath: resolvedPlan.targetVideoPath,
      nfoPath: resolvedPlan.nfoPath ?? plan.nfoPath,
      strmPath: plan.strmPath ? join(metadataDir, `${parse(resolvedPlan.targetVideoPath).name}.strm`) : undefined,
      subtitleSidecars: resolvedPlan.subtitleSidecars,
    };
  }

  async organizeVideo(fileInfo: FileInfo, plan: OrganizePlan, config: Configuration): Promise<string> {
    let organizedPath: string;
    if (!config.behavior.successFileMove) {
      if (!config.behavior.successFileRename) {
        this.logger.info(`successFileMove disabled; leaving file at ${fileInfo.filePath}`);
        organizedPath = fileInfo.filePath;
      } else {
        organizedPath = await this.fileMover.moveBundledMedia(fileInfo.filePath, plan.targetVideoPath, {
          subtitleSidecars: plan.subtitleSidecars,
          sharedMovieBaseName: parse(plan.nfoPath).name,
        });
      }
    } else {
      const sourceDir = dirname(fileInfo.filePath);
      organizedPath = await this.fileMover.moveBundledMedia(fileInfo.filePath, plan.targetVideoPath, {
        subtitleSidecars: plan.subtitleSidecars,
        sharedMovieBaseName: parse(plan.nfoPath).name,
      });

      if (config.behavior.deleteEmptyFolder) {
        const mediaRoot = resolve(config.paths.mediaPath.trim() || dirname(fileInfo.filePath));
        await this.fileMover.cleanupEmptyAncestors(sourceDir, mediaRoot);
      }
    }

    if (plan.strmPath) {
      await this.writeMetadataStrm(plan.strmPath, organizedPath);
    }

    return organizedPath;
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

  private resolveMetadataDir(outputDir: string, config: Configuration): string {
    const configuredMetadataRoot = config.paths.metadataPath.trim();
    if (!configuredMetadataRoot) {
      return outputDir;
    }

    const configuredMediaRoot = config.paths.mediaPath.trim();
    if (!configuredMediaRoot) {
      throw new Error("配置本地元数据目录时，媒体目录不能为空");
    }
    if (!isAbsolute(configuredMediaRoot) || !isAbsolute(configuredMetadataRoot)) {
      throw new Error("媒体目录和本地元数据目录必须使用绝对路径");
    }

    const mediaRoot = resolve(configuredMediaRoot);
    const metadataRoot = resolve(configuredMetadataRoot);
    if (this.isPathInside(mediaRoot, metadataRoot) || this.isPathInside(metadataRoot, mediaRoot)) {
      throw new Error("本地元数据目录不能与媒体目录相同或互相包含");
    }

    const outputRelativePath = relative(mediaRoot, resolve(outputDir));
    if (outputRelativePath.startsWith(`..${sep}`) || outputRelativePath === ".." || isAbsolute(outputRelativePath)) {
      throw new Error(`影片输出目录不在媒体目录内：${outputDir}`);
    }

    return resolve(metadataRoot, outputRelativePath);
  }

  private isPathInside(rootPath: string, candidatePath: string): boolean {
    const candidateRelativePath = relative(resolve(rootPath), resolve(candidatePath));
    return (
      candidateRelativePath === "" ||
      (!candidateRelativePath.startsWith(`..${sep}`) &&
        candidateRelativePath !== ".." &&
        !isAbsolute(candidateRelativePath))
    );
  }

  private async writeMetadataStrm(strmPath: string, organizedVideoPath: string): Promise<void> {
    let target = resolve(organizedVideoPath);
    if (isStrmFile(organizedVideoPath)) {
      const sourceTarget = await inspectStrmTarget(organizedVideoPath);
      if (!sourceTarget) {
        throw new Error(`STRM 文件不包含有效目标：${organizedVideoPath}`);
      }
      target = sourceTarget.kind === "url" ? sourceTarget.target : (sourceTarget.resolvedPath ?? sourceTarget.target);
    }

    await writeStrmTarget(strmPath, target);
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

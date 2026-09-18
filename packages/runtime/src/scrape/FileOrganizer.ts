import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { isPathInside } from "@mdcz/media-store";
import { buildMovieAssetFileNames } from "@mdcz/shared/assetNaming";

import type { Configuration } from "@mdcz/shared/config";
import type { CrawlerData, FileInfo, NamingPreviewItem, NfoLocalState } from "@mdcz/shared/types";
import { noopRuntimeLogger, type RuntimeLogger } from "../shared";
import { DirectoryInventory } from "./DirectoryInventory";
import {
  buildGeneratedVideoSidecarTargetPath,
  buildSubtitleSidecarTargetPath,
  findGeneratedVideoSidecars,
  findSubtitleSidecars,
  isGeneratedSidecarVideo,
  type SubtitleSidecarMatch,
} from "./media";
import { getNfoWritePaths } from "./nfo";
import { NAMING_PREVIEW_SAMPLES, NamingEngine } from "./organize/NamingEngine";
import { DEFAULT_VIDEO_EXTENSIONS, ensureParentDirectory } from "./utils/filesystem";
import { parseFileInfo } from "./utils/number";
import { mapStrmPath, prepareMovedStrmContent, prepareStrmMirrorContent } from "./utils/strm";

export interface OrganizePlan {
  outputDir: string;
  metadataDir: string;
  metadataRoot?: string;
  mode: "preserve" | "move";
  targetVideoPath: string;
  nfoPath: string;
  strmPath?: string;
  renameSubtitles: boolean;
}

export interface ResolvedPublicationLayout {
  mode: "preserve" | "move";
  sourceVideoPath: string;
  targetVideoPath: string;
  outputDir: string;
  metadataDir: string;
  existingMetadataDir: string;
  nfoPath: string;
  mediaContent?: string;
  mirror?: { targetPath: string; content: string };
  sidecars: Array<{
    kind: "subtitle" | "feature";
    sourcePath: string;
    targetPath: string;
    mirrorPath?: string;
  }>;
}

/**
 * Parts of one number share the metadata directory and its fixed asset names
 * (poster.jpg, extrafanart, .actors), so serializing publication per NFO file
 * is too narrow: the whole directory has to be covered.
 */
export const buildScrapePublicationKey = <T extends Pick<OrganizePlan, "metadataDir">>(plan: T): string =>
  `scrape-publication:${resolve(plan.metadataDir)}`;

interface ResolveOutputPlanOptions {
  createDirectories?: boolean;
  allowSharedDirectory?: boolean;
  subtitleSidecars?: SubtitleSidecarMatch[];
  inventory?: DirectoryInventory;
}

export interface OrganizePlanOptions {
  executionMode?: ScrapeExecutionMode;
  outputDirectory?: string;
  outputTemplateRoot?: string;
}

export type ScrapeExecutionMode = "single" | "batch";

export const resolveOrganizeDirectory = (
  sourcePath: string,
  config: Configuration,
  options: OrganizePlanOptions = {},
): { directory: string; useFolderTemplate: boolean } => {
  const sourceDir = resolve(dirname(sourcePath));
  if (!config.behavior.successFileMove) {
    return { directory: sourceDir, useFolderTemplate: false };
  }
  if (options.outputDirectory) return { directory: resolve(options.outputDirectory), useFolderTemplate: false };
  if (options.outputTemplateRoot) return { directory: resolve(options.outputTemplateRoot), useFolderTemplate: true };
  const base = resolve(config.paths.mediaPath.trim() || sourceDir, config.paths.successOutputFolder.trim());
  return { directory: base, useFolderTemplate: true };
};

export class FileOrganizer {
  private readonly logger: RuntimeLogger;

  private readonly namingEngine = new NamingEngine();

  constructor(logger: RuntimeLogger = noopRuntimeLogger) {
    this.logger = logger;
  }

  plan(
    fileInfo: FileInfo,
    data: CrawlerData,
    config: Configuration,
    localState?: NfoLocalState,
    options: OrganizePlanOptions = {},
  ): OrganizePlan {
    const layout = this.namingEngine.buildLayout(fileInfo, data, config, localState);
    const metadataRoot = config.paths.metadataPath.trim();

    if (config.behavior.metadataOnly) {
      if (!metadataRoot) {
        throw new Error("启用仅输出元数据模式时，必须指定元数据输出目录");
      }
      if (!isAbsolute(metadataRoot)) {
        throw new Error("元数据输出目录必须使用绝对路径");
      }
      const sourceDir = resolve(dirname(fileInfo.filePath));
      const metadataDir = resolve(metadataRoot, layout.folderRelativePath);
      if (!isPathInside(metadataRoot, metadataDir)) {
        throw new Error("模板结果超出元数据输出目录");
      }
      if (
        metadataDir === sourceDir ||
        metadataRoot === sourceDir ||
        isPathInside(sourceDir, metadataRoot) ||
        isPathInside(metadataRoot, sourceDir)
      ) {
        throw new Error("元数据输出目录不能与源媒体目录相同或互相包含");
      }
      const nfoPath = join(metadataDir, layout.nfoFileName);
      const strmPath = config.behavior.generateStrm ? join(metadataDir, layout.strmFileName) : undefined;

      return {
        outputDir: sourceDir,
        metadataDir,
        metadataRoot,
        mode: "preserve",
        targetVideoPath: fileInfo.filePath,
        nfoPath,
        strmPath,
        renameSubtitles: false,
      };
    }

    const { directory, useFolderTemplate } = resolveOrganizeDirectory(fileInfo.filePath, config, options);
    const outputDir = useFolderTemplate ? join(directory, layout.folderRelativePath) : directory;

    const generatedTargetVideoPath = join(outputDir, layout.targetVideoFileName);
    const moveMedia = config.behavior.successFileMove || config.behavior.successFileRename;
    const targetVideoPath = moveMedia ? generatedTargetVideoPath : fileInfo.filePath;
    if (!isPathInside(directory, outputDir)) throw new Error("模板结果超出整理目标目录");
    const nfoPath = join(outputDir, layout.nfoFileName);

    return {
      outputDir,
      metadataDir: outputDir,
      metadataRoot: undefined,
      mode: moveMedia ? "move" : "preserve",
      targetVideoPath,
      nfoPath,
      strmPath: undefined,
      renameSubtitles: config.behavior.successFileRename,
    };
  }

  buildNamingPreview(config: Configuration): NamingPreviewItem[] {
    return NAMING_PREVIEW_SAMPLES.map((sample) => {
      const layout = this.namingEngine.buildLayout(sample.fileInfo, sample.data, config, sample.localState);
      const plan = this.plan(sample.fileInfo, sample.data, config, sample.localState);
      const assets = buildMovieAssetFileNames(basename(plan.nfoPath, ".nfo"), config.naming.assetNamingMode);
      return {
        label: sample.label,
        folder:
          config.behavior.metadataOnly || config.behavior.successFileMove
            ? layout.folderRelativePath || "当前目录"
            : "当前目录",
        file: layout.targetVideoFileName,
        sourcePath: resolve(sample.fileInfo.filePath),
        mediaPath: plan.targetVideoPath,
        metadataDir: plan.metadataDir,
        strmFileName: plan.strmPath ? basename(plan.strmPath) : undefined,
        strmContent: plan.strmPath ? mapStrmPath(plan.targetVideoPath, config.paths.strmPathMappings) : undefined,
        subtitles: plan.strmPath ? [`${basename(plan.strmPath, ".strm")}.zh.srt`] : [],
        outputs: [
          ...(config.download.generateNfo
            ? getNfoWritePaths(plan.nfoPath, config.download.nfoNaming).requiredPaths.map((path) => basename(path))
            : []),
          ...(config.download.downloadThumb ? [assets.thumb] : []),
          ...(config.download.downloadPoster ? [assets.poster] : []),
          ...(config.download.downloadFanart ? [assets.fanart] : []),
          ...(config.download.downloadTrailer ? [assets.trailer] : []),
          ...(config.download.downloadSceneImages ? [`${config.paths.sceneImagesFolder}/…`] : []),
        ],
      };
    });
  }

  async resolveOutputPlan(
    plan: OrganizePlan,
    sourceFilePath: string,
    options: ResolveOutputPlanOptions & {
      existingMetadataDir?: string;
      strmPathMappings?: Configuration["paths"]["strmPathMappings"];
    } = {},
  ): Promise<ResolvedPublicationLayout> {
    if (options.createDirectories) {
      await ensureParentDirectory(plan.targetVideoPath);
      await ensureParentDirectory(plan.nfoPath);
      if (plan.strmPath) {
        await ensureParentDirectory(plan.strmPath);
      }
    }

    const outputRoot = plan.metadataDir;
    const sourceDir = resolve(dirname(sourceFilePath));
    const sameDirectoryOutput = sourceDir === resolve(outputRoot);
    const inventory = options.inventory ?? new DirectoryInventory();

    if (sameDirectoryOutput && !options.allowSharedDirectory) {
      const sourceFileInfo = parseFileInfo(sourceFilePath);
      const videoFiles: string[] = [];
      for (const entry of await inventory.mediaEntries(sourceDir)) {
        if (!DEFAULT_VIDEO_EXTENSIONS.has(parseFileInfo(entry.name).extension.toLowerCase())) continue;
        const candidate = join(sourceDir, entry.name);
        if (entry.isFile() || (entry.isSymbolicLink() && (await inventory.stats(candidate)).isFile()))
          videoFiles.push(candidate);
      }
      const otherVideos = videoFiles.filter((filePath) => {
        if (resolve(filePath) === resolve(sourceFilePath) || isGeneratedSidecarVideo(filePath)) {
          return false;
        }

        const siblingFileInfo = parseFileInfo(filePath);
        if (sourceFileInfo.number && sourceFileInfo.number === siblingFileInfo.number) {
          return false;
        }

        return true;
      });
      if (otherVideos.length > 0) {
        this.logger.warn(`Cannot organize in place because multiple video files exist in ${sourceDir}`);
        throw new Error("源目录包含多部影片，请启用仅输出元数据并设置独立目录，或使用按影片命名的 NFO 和图片");
      }
    }

    const moveMedia = plan.mode === "move";
    const subtitleSidecars = options.subtitleSidecars ?? (await findSubtitleSidecars(sourceFilePath, inventory));
    const sidecars: ResolvedPublicationLayout["sidecars"] = subtitleSidecars.map((subtitle) => {
      const targetPath = moveMedia
        ? plan.renameSubtitles
          ? buildSubtitleSidecarTargetPath(subtitle, plan.targetVideoPath)
          : join(dirname(plan.targetVideoPath), basename(subtitle.path))
        : subtitle.path;
      return {
        kind: "subtitle",
        sourcePath: subtitle.path,
        targetPath,
        ...(plan.strmPath ? { mirrorPath: buildSubtitleSidecarTargetPath(subtitle, plan.strmPath) } : {}),
      };
    });
    for (const feature of await findGeneratedVideoSidecars(sourceFilePath, inventory)) {
      sidecars.push({
        kind: "feature",
        sourcePath: feature.path,
        targetPath: moveMedia
          ? buildGeneratedVideoSidecarTargetPath(feature, dirname(plan.targetVideoPath), basename(plan.nfoPath, ".nfo"))
          : feature.path,
      });
    }
    const mediaContent = moveMedia ? await prepareMovedStrmContent(sourceFilePath, plan.targetVideoPath) : undefined;
    const mirror = plan.strmPath
      ? {
          targetPath: plan.strmPath,
          content: await prepareStrmMirrorContent(sourceFilePath, plan.targetVideoPath, options.strmPathMappings),
        }
      : undefined;
    return {
      mode: moveMedia ? "move" : "preserve",
      sourceVideoPath: sourceFilePath,
      targetVideoPath: plan.targetVideoPath,
      outputDir: plan.outputDir,
      metadataDir: plan.metadataDir,
      existingMetadataDir: options.existingMetadataDir ?? dirname(sourceFilePath),
      nfoPath: plan.nfoPath,
      ...(mediaContent === undefined ? {} : { mediaContent }),
      ...(mirror ? { mirror } : {}),
      sidecars,
    };
  }
}

export const fileOrganizer = new FileOrganizer();

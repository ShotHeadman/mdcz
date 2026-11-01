import { basename, dirname, join, parse, resolve } from "node:path";
import { isPathInside } from "@mdcz/media-store";
import { buildMovieAssetFileNames } from "@mdcz/shared/assetNaming";
import type { Configuration } from "@mdcz/shared/config";
import { type PublicationTarget, resolveMovieNaming } from "@mdcz/shared/mediaLibrary";
import type { CrawlerData, FileInfo, NamingPreviewItem, NfoLocalState } from "@mdcz/shared/types";
import { DirectoryInventory } from "./DirectoryInventory";
import {
  buildGeneratedVideoSidecarTargetPath,
  buildSubtitleSidecarTargetPath,
  findGeneratedVideoSidecars,
  findSubtitleSidecars,
  type SubtitleSidecarMatch,
} from "./media";
import { getNfoWritePaths } from "./nfo";
import { NAMING_PREVIEW_SAMPLES, NamingEngine } from "./organize/NamingEngine";
import { isStrmFile, prepareMovedStrmContent } from "./utils/strm";

/** How a placed video reaches its target; the source stays on disk for `hardlink` and `copy`. */
export type MediaTransfer = "move" | "hardlink" | "copy";

/** A link written next to the metadata, pointing at a video that stays where it is. */
export interface MediaLink {
  kind: "symlink" | "strm";
  path: string;
}

export interface OrganizePlan {
  outputDir: string;
  metadataDir: string;
  /** `move`: the video is placed at `targetVideoPath` by `transfer`; `preserve`: it stays at its source. */
  mode: "preserve" | "move";
  transfer?: MediaTransfer;
  link?: MediaLink;
  targetVideoPath: string;
  nfoPath: string;
  renameSubtitles: boolean;
}

export interface ResolvedPublicationLayout {
  mode: "preserve" | "move";
  transfer?: MediaTransfer;
  link?: MediaLink;
  sourceVideoPath: string;
  targetVideoPath: string;
  outputDir: string;
  metadataDir: string;
  existingMetadataDir: string;
  nfoPath: string;
  mediaContent?: string;
  sidecars: Array<{
    kind: "subtitle" | "feature";
    sourcePath: string;
    targetPath: string;
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
  subtitleSidecars?: SubtitleSidecarMatch[];
  inventory?: DirectoryInventory;
}

export interface OrganizePlanOptions {
  versionLabel?: string;
}

export class FileOrganizer {
  private readonly namingEngine = new NamingEngine();

  plan(
    fileInfo: FileInfo,
    data: CrawlerData,
    config: Configuration,
    target: Pick<PublicationTarget, "placement" | "outputPath" | "folderTemplate" | "fileTemplate">,
    localState?: NfoLocalState,
    options: OrganizePlanOptions = {},
  ): OrganizePlan {
    const layout = this.namingEngine.buildLayout(fileInfo, data, config, target, localState);
    const sourceDir = resolve(dirname(fileInfo.filePath));
    if (target.placement === "inPlace") {
      return {
        outputDir: sourceDir,
        metadataDir: sourceDir,
        mode: "preserve",
        targetVideoPath: fileInfo.filePath,
        nfoPath: join(sourceDir, layout.nfoFileName),
        renameSubtitles: false,
      };
    }

    const outputRoot = resolve(target.outputPath);
    const outputDir = resolve(outputRoot, layout.folderRelativePath);
    if (!isPathInside(outputRoot, outputDir)) throw new Error("Generated path is outside the library output directory");
    const placedName = options.versionLabel
      ? `${parse(layout.targetVideoFileName).name} - ${options.versionLabel}${parse(layout.targetVideoFileName).ext}`
      : layout.targetVideoFileName;
    const nfoPath = join(outputDir, layout.nfoFileName);
    if (target.placement === "move" || target.placement === "hardlink" || target.placement === "copy") {
      return {
        outputDir,
        metadataDir: outputDir,
        mode: "move",
        transfer: target.placement,
        targetVideoPath: join(outputDir, placedName),
        nfoPath,
        renameSubtitles: true,
      };
    }

    if (target.placement === "strm" && isStrmFile(fileInfo.filePath)) {
      throw new Error("A .strm source is already a link; use a library that places files in place or moves them");
    }
    if (isPathInside(sourceDir, outputRoot) || isPathInside(outputRoot, sourceDir)) {
      throw new Error("The library output directory cannot be the same as or contain the video's directory");
    }
    const link: MediaLink | undefined =
      target.placement === "symlink"
        ? { kind: "symlink", path: join(outputDir, placedName) }
        : target.placement === "strm"
          ? { kind: "strm", path: join(outputDir, `${parse(placedName).name}.strm`) }
          : undefined;
    return {
      outputDir,
      metadataDir: outputDir,
      mode: "preserve",
      link,
      targetVideoPath: fileInfo.filePath,
      nfoPath,
      renameSubtitles: Boolean(link),
    };
  }

  buildNamingPreview(config: Configuration, target: PublicationTarget): NamingPreviewItem[] {
    return NAMING_PREVIEW_SAMPLES.map((sample) => {
      const layout = this.namingEngine.buildLayout(sample.fileInfo, sample.data, config, target, sample.localState);
      const plan = this.plan(sample.fileInfo, sample.data, config, target, sample.localState);
      const naming = resolveMovieNaming({
        policy: target,
        holdsOtherMovies: false,
        downloadSceneImages: config.download.downloadSceneImages,
      });
      const assets = buildMovieAssetFileNames(basename(plan.nfoPath, ".nfo"), naming.assetNaming);
      return {
        sample: sample.sample,
        folder: target.placement === "inPlace" ? "" : layout.folderRelativePath,
        file: plan.link ? basename(plan.link.path) : layout.targetVideoFileName,
        sourcePath: resolve(sample.fileInfo.filePath),
        mediaPath: plan.link?.path ?? plan.targetVideoPath,
        metadataDir: plan.metadataDir,
        outputs: [
          ...(config.download.generateNfo
            ? getNfoWritePaths(plan.nfoPath, naming.nfoNaming).requiredPaths.map((path) => basename(path))
            : []),
          ...(config.download.downloadThumb ? [assets.thumb] : []),
          ...(config.download.downloadPoster ? [assets.poster] : []),
          ...(config.download.downloadFanart ? [assets.fanart] : []),
          ...(config.download.downloadTrailer ? [assets.trailer] : []),
          ...(naming.sceneImages ? [`${config.paths.sceneImagesFolder}/…`] : []),
        ],
      };
    });
  }

  async resolveOutputPlan(
    plan: OrganizePlan,
    sourceFilePath: string,
    options: ResolveOutputPlanOptions & {
      existingMetadataDir?: string;
    } = {},
  ): Promise<ResolvedPublicationLayout> {
    const inventory = options.inventory ?? new DirectoryInventory();
    const moveMedia = plan.mode === "move";
    // Media servers look for subtitles next to the file they play, which is the link in link placements.
    const playedPath = moveMedia ? plan.targetVideoPath : plan.link?.path;
    const subtitleSidecars = options.subtitleSidecars ?? (await findSubtitleSidecars(sourceFilePath, inventory));
    const sidecars: ResolvedPublicationLayout["sidecars"] = subtitleSidecars.map((subtitle) => {
      const targetPath = playedPath
        ? plan.renameSubtitles
          ? buildSubtitleSidecarTargetPath(subtitle, playedPath)
          : join(dirname(playedPath), basename(subtitle.path))
        : subtitle.path;
      return {
        kind: "subtitle",
        sourcePath: subtitle.path,
        targetPath,
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
    return {
      mode: moveMedia ? "move" : "preserve",
      ...(moveMedia ? { transfer: plan.transfer ?? "move" } : {}),
      ...(plan.link ? { link: plan.link } : {}),
      sourceVideoPath: sourceFilePath,
      targetVideoPath: plan.targetVideoPath,
      outputDir: plan.outputDir,
      metadataDir: plan.metadataDir,
      existingMetadataDir: options.existingMetadataDir ?? dirname(sourceFilePath),
      nfoPath: plan.nfoPath,
      ...(mediaContent === undefined ? {} : { mediaContent }),
      sidecars,
    };
  }
}

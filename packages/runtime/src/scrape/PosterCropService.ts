import { basename, dirname, extname, join } from "node:path";
import { type AssetNamingMode, buildMovieAssetFileNames } from "@mdcz/shared/assetNaming";
import {
  type NormalizedCropRegion,
  normalizedCropToPixels,
  resolvePosterEditorCropRegion,
} from "@mdcz/shared/posterCrop";
import sharp from "sharp";
import { type MovieLibrary, writePublishedMovie } from "../library/registeredMedia";
import { acquireOutputDirectories } from "../publication/outputMutex";
import { toRootFileRef } from "../publication/outputRefs";
import { WriteOutput } from "../publication/WriteOutput";
import { DirectoryInventory } from "./DirectoryInventory";
import { resolveExistingImageAsset } from "./download/assets/helpers";

const supportedExtensions = new Set([".avif", ".jpeg", ".jpg", ".png", ".webp"]);

const encodePoster = (pipeline: sharp.Sharp, extension: string): sharp.Sharp => {
  switch (extension) {
    case ".avif":
      return pipeline.avif({ quality: 90 });
    case ".png":
      return pipeline.png();
    case ".webp":
      return pipeline.webp({ quality: 95 });
    default:
      return pipeline.jpeg({ quality: 95, chromaSubsampling: "4:4:4" });
  }
};

export interface PosterCropSession {
  sourcePath: string;
  targetPath: string;
  width: number;
  height: number;
  initialCrop: NormalizedCropRegion;
}

export class PosterCropService {
  async prepare(
    videoPath: string,
    assetNamingMode: AssetNamingMode,
    assets?: { thumb?: string; poster?: string },
  ): Promise<PosterCropSession> {
    const outputDir = dirname(videoPath);
    const videoBaseName = basename(videoPath, extname(videoPath));
    const names = buildMovieAssetFileNames(videoBaseName, assetNamingMode);
    const thumbTargetPath = join(outputDir, names.thumb);
    const posterTargetPath =
      assets?.poster ??
      (assets?.thumb
        ? join(
            dirname(assets.thumb),
            /thumb(?=\.[^.]+$)/u.test(basename(assets.thumb))
              ? basename(assets.thumb).replace(/thumb(?=\.[^.]+$)/u, "poster")
              : names.poster,
          )
        : join(outputDir, names.poster));
    const inventory = new DirectoryInventory();
    const thumbPath = assets ? assets.thumb : await resolveExistingImageAsset(thumbTargetPath, inventory);
    const posterPath = assets ? assets.poster : await resolveExistingImageAsset(posterTargetPath, inventory);
    const sourcePath = thumbPath ?? posterPath;
    if (!sourcePath) throw new Error("No local thumb or poster is available for editing");

    const metadata = await sharp(sourcePath, { animated: false }).rotate().metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (width <= 0 || height <= 0) throw new Error("Unable to read poster source dimensions");
    return {
      sourcePath,
      targetPath: posterPath ?? posterTargetPath,
      width,
      height,
      initialCrop: resolvePosterEditorCropRegion(width, height),
    };
  }

  async save(
    videoPath: string,
    assetNamingMode: AssetNamingMode,
    crop: NormalizedCropRegion,
    assets?: { thumb?: string; poster?: string },
    movie?: {
      library: MovieLibrary;
      movieId: string;
      roots: readonly { id: string; hostPath: string }[];
    },
  ): Promise<PosterCropSession & { revision: string }> {
    const session = await this.prepare(videoPath, assetNamingMode, assets);
    const extension = extname(session.targetPath).toLowerCase() || ".jpg";
    if (!supportedExtensions.has(extension)) throw new Error(`Unsupported poster format: ${extension}`);
    const pixelCrop = normalizedCropToPixels(crop, session.width, session.height);
    const source = sharp(session.sourcePath, { animated: false }).rotate().extract(pixelCrop);
    const data = await encodePoster(source, extension).toBuffer();
    const inventory = new DirectoryInventory();
    const release = await acquireOutputDirectories([session.targetPath], (directory) =>
      inventory.canonicalDirectory(directory),
    );
    try {
      await new WriteOutput().install([{ targetPath: session.targetPath, data }], {
        protectedMediaFiles: [videoPath],
        commit: async () => {
          if (!movie) return;
          const ref = toRootFileRef(session.targetPath, movie.roots);
          await writePublishedMovie(movie.library, movie.movieId, [
            {
              kind: "poster",
              uri: ref.relativePath,
              rootId: ref.rootId,
              relativePath: ref.relativePath,
              published: true,
            },
          ]);
        },
      });
    } finally {
      release();
    }
    return { ...session, revision: String(Date.now()) };
  }
}

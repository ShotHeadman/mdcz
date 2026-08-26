import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { basename, dirname, extname, join, parse } from "node:path";
import { type AssetNamingMode, buildMovieAssetFileNames } from "@mdcz/shared/assetNaming";
import {
  type NormalizedCropRegion,
  normalizedCropToPixels,
  resolvePosterEditorCropRegion,
} from "@mdcz/shared/posterCrop";
import sharp from "sharp";
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
  async prepare(videoPath: string, assetNamingMode: AssetNamingMode): Promise<PosterCropSession> {
    const outputDir = dirname(videoPath);
    const videoBaseName = basename(videoPath, extname(videoPath));
    const names = buildMovieAssetFileNames(videoBaseName, assetNamingMode);
    const thumbTargetPath = join(outputDir, names.thumb);
    const posterTargetPath = join(outputDir, names.poster);
    const thumbPath = await resolveExistingImageAsset(thumbTargetPath);
    const posterPath = await resolveExistingImageAsset(posterTargetPath);
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
  ): Promise<PosterCropSession & { revision: string }> {
    const session = await this.prepare(videoPath, assetNamingMode);
    const extension = extname(session.targetPath).toLowerCase() || ".jpg";
    if (!supportedExtensions.has(extension)) throw new Error(`Unsupported poster format: ${extension}`);
    const pixelCrop = normalizedCropToPixels(crop, session.width, session.height);
    const parsed = parse(session.targetPath);
    const tempPath = join(parsed.dir, `.${parsed.name}.poster-crop.${randomUUID()}${extension}`);
    await mkdir(parsed.dir, { recursive: true });
    try {
      const source = sharp(session.sourcePath, { animated: false }).rotate().extract(pixelCrop);
      await encodePoster(source, extension).toFile(tempPath);
      await rename(tempPath, session.targetPath);
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
    return { ...session, revision: String(Date.now()) };
  }
}

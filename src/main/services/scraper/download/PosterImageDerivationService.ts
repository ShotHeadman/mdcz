import { randomUUID } from "node:crypto";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, extname, join, parse } from "node:path";
import { toErrorMessage } from "@main/utils/common";
import sharp from "sharp";

const SMALL_POSTER_THRESHOLD_BYTES = 50_000;
const PORTRAIT_ASPECT_RATIO_THRESHOLD = 1.4;

export type PosterDerivationResult =
  | { status: "derived"; path: string }
  | { status: "skipped"; reason: "large_poster" | "missing_thumb" | "portrait_thumb" | "unreadable_poster" };

interface PosterDerivationLogger {
  warn(message: string): void;
}

export interface DerivePosterFromThumbOptions {
  posterPath: string | undefined;
  targetPath: string;
  thumbPath: string | undefined;
}

interface CropRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

const inferOutputExtension = (filePath: string): string => {
  const extension = extname(filePath);
  return extension || ".jpg";
};

const encodePoster = (pipeline: sharp.Sharp, outputPath: string): sharp.Sharp => {
  switch (inferOutputExtension(outputPath).toLowerCase()) {
    case ".png":
      return pipeline.png();
    case ".webp":
      return pipeline.webp({ quality: 95 });
    default:
      return pipeline.jpeg({ quality: 95, chromaSubsampling: "4:4:4" });
  }
};

const clampCropRegion = (region: CropRegion, imageWidth: number, imageHeight: number): CropRegion => {
  const left = Math.min(Math.max(0, Math.round(region.left)), Math.max(0, imageWidth - 1));
  const top = Math.min(Math.max(0, Math.round(region.top)), Math.max(0, imageHeight - 1));
  const width = Math.min(Math.max(1, Math.round(region.width)), imageWidth - left);
  const height = Math.min(Math.max(1, Math.round(region.height)), imageHeight - top);

  return { left, top, width, height };
};

export const resolveThumbToPosterCropRegion = (imageWidth: number, imageHeight: number): CropRegion | null => {
  const prop = imageHeight / imageWidth;
  if (prop >= PORTRAIT_ASPECT_RATIO_THRESHOLD) {
    return null;
  }

  if (prop >= 1) {
    const cropWidth = Math.floor(imageHeight / 1.5);
    return clampCropRegion(
      {
        left: Math.floor((imageWidth - cropWidth) / 2),
        top: 0,
        width: cropWidth,
        height: imageHeight,
      },
      imageWidth,
      imageHeight,
    );
  }

  let left = Math.round(imageWidth / 1.9);
  let right = imageWidth;
  if (imageWidth === 800) {
    if (imageHeight === 439) {
      left = 420;
    } else if (imageHeight >= 499 && imageHeight <= 503) {
      left = 437;
    } else {
      left = 421;
    }
  } else if (imageWidth === 840 && imageHeight === 472) {
    left = 473;
    right = 788;
  }

  return clampCropRegion(
    {
      left,
      top: 0,
      width: right - left,
      height: imageHeight,
    },
    imageWidth,
    imageHeight,
  );
};

export class PosterImageDerivationService {
  constructor(private readonly logger: PosterDerivationLogger) {}

  async deriveFromThumbIfNeeded(options: DerivePosterFromThumbOptions): Promise<PosterDerivationResult> {
    if (options.posterPath) {
      const shouldDerive = await this.isSmallPoster(options.posterPath);
      if (shouldDerive === false) {
        return { status: "skipped", reason: "large_poster" };
      }
      if (shouldDerive === null) {
        return { status: "skipped", reason: "unreadable_poster" };
      }
    }

    if (!options.thumbPath) {
      this.logger.warn(`Cannot derive poster from thumb: thumb asset is missing for ${options.targetPath}`);
      return { status: "skipped", reason: "missing_thumb" };
    }

    const outputPath = options.posterPath ?? options.targetPath;

    try {
      const source = sharp(options.thumbPath, { animated: false }).rotate();
      const metadata = await source.metadata();
      const width = metadata.width ?? 0;
      const height = metadata.height ?? 0;
      if (width <= 0 || height <= 0) {
        throw new Error(`Unable to read thumb dimensions for ${options.thumbPath}`);
      }

      const cropRegion = resolveThumbToPosterCropRegion(width, height);
      if (!cropRegion) {
        return { status: "skipped", reason: "portrait_thumb" };
      }

      const parsedPath = parse(outputPath);
      const tempPath = join(
        parsedPath.dir,
        `${parsedPath.name}.derived-poster.${randomUUID()}${inferOutputExtension(outputPath)}`,
      );
      await mkdir(dirname(tempPath), { recursive: true });

      try {
        await encodePoster(source.extract(cropRegion), outputPath).toFile(tempPath);
        await rename(tempPath, outputPath);
      } finally {
        await unlink(tempPath).catch(() => undefined);
      }

      return { status: "derived", path: outputPath };
    } catch (error) {
      this.logger.warn(`Failed to derive poster from thumb ${options.thumbPath}: ${toErrorMessage(error)}`);
      return { status: "skipped", reason: options.posterPath ? "unreadable_poster" : "missing_thumb" };
    }
  }

  private async isSmallPoster(posterPath: string): Promise<boolean | null> {
    try {
      const posterStat = await stat(posterPath);
      return posterStat.size < SMALL_POSTER_THRESHOLD_BYTES;
    } catch (error) {
      this.logger.warn(`Cannot inspect poster size for ${posterPath}: ${toErrorMessage(error)}`);
      return null;
    }
  }
}

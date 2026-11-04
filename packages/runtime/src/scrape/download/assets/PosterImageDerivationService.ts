import { randomUUID } from "node:crypto";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, extname, join, parse } from "node:path";
import { resolveThumbToPosterCropRegion } from "@mdcz/shared/posterCrop";
import sharp, { type Sharp } from "sharp";
import { toErrorMessage } from "../../../shared";

const SMALL_POSTER_THRESHOLD_BYTES = 50_000;

export type PosterDerivationResult =
  | { status: "derived"; path: string }
  | { status: "skipped"; reason: "large_poster" | "missing_thumb" | "unreadable_poster" };

interface PosterDerivationLogger {
  warn(message: string): void;
}

export interface DerivePosterFromThumbOptions {
  posterPath: string | undefined;
  targetPath: string;
  /** Called only once the poster needs replacing, so a cover fetched just for the crop is not fetched in vain. */
  resolveThumbPath: () => Promise<string | undefined>;
}

const inferOutputExtension = (filePath: string): string => extname(filePath) || ".jpg";

const encodePoster = (pipeline: Sharp, outputPath: string): Sharp => {
  switch (inferOutputExtension(outputPath).toLowerCase()) {
    case ".png":
      return pipeline.png();
    case ".webp":
      return pipeline.webp({ quality: 95 });
    default:
      return pipeline.jpeg({ quality: 95, chromaSubsampling: "4:4:4" });
  }
};

export { resolveThumbToPosterCropRegion } from "@mdcz/shared/posterCrop";

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

    const thumbPath = await options.resolveThumbPath();
    if (!thumbPath) {
      this.logger.warn(`Cannot derive poster from thumb: thumb asset is missing for ${options.targetPath}`);
      return { status: "skipped", reason: "missing_thumb" };
    }

    const outputPath = options.posterPath ?? options.targetPath;

    try {
      const source = sharp(thumbPath, { animated: false }).rotate();
      const metadata = await source.metadata();
      const width = metadata.width ?? 0;
      const height = metadata.height ?? 0;
      if (width <= 0 || height <= 0) {
        throw new Error(`Unable to read thumb dimensions for ${thumbPath}`);
      }

      // A portrait cover is already poster-shaped and is used whole.
      const cropRegion = resolveThumbToPosterCropRegion(width, height);

      const parsedPath = parse(outputPath);
      const tempPath = join(
        parsedPath.dir,
        `${parsedPath.name}.derived-poster.${randomUUID()}${inferOutputExtension(outputPath)}`,
      );
      await mkdir(dirname(tempPath), { recursive: true });

      try {
        await encodePoster(cropRegion ? source.extract(cropRegion) : source, outputPath).toFile(tempPath);
        await rename(tempPath, outputPath);
      } finally {
        await unlink(tempPath).catch(() => undefined);
      }

      return { status: "derived", path: outputPath };
    } catch (error) {
      this.logger.warn(`Failed to derive poster from thumb ${thumbPath}: ${toErrorMessage(error)}`);
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

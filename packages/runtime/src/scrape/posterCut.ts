import { extname } from "node:path";
import { isPosterShaped, type NormalizedCropRegion, normalizedCropToPixels } from "@mdcz/shared/posterCrop";
import sharp, { type Sharp } from "sharp";

export const encodePoster = (pipeline: Sharp, targetPath: string): Sharp => {
  switch (extname(targetPath).toLowerCase()) {
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

/** Writes the area `crop` of an image as a poster; false when that area isn't 2:3 on this image. */
export const cutPoster = async (
  sourcePath: string,
  crop: NormalizedCropRegion,
  targetPath: string,
): Promise<boolean> => {
  const source = sharp(sourcePath, { animated: false }).rotate();
  const { width = 0, height = 0 } = await source.metadata();
  if (!isPosterShaped(crop, width, height)) return false;
  await encodePoster(source.extract(normalizedCropToPixels(crop, width, height)), targetPath).toFile(targetPath);
  return true;
};

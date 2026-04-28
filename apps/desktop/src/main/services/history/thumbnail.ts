import sharp from "sharp";

export const createThumbnailBuffer = async (posterPath: string): Promise<Buffer> =>
  await sharp(posterPath).resize(200, 300, { fit: "cover" }).webp({ quality: 75 }).toBuffer();

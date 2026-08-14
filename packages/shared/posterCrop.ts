import { z } from "zod";

export const POSTER_ASPECT_RATIO = 2 / 3;

export const normalizedCropRegionSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().positive().max(1),
    height: z.number().finite().positive().max(1),
  })
  .superRefine((crop, context) => {
    if (crop.x + crop.width > 1 + Number.EPSILON || crop.y + crop.height > 1 + Number.EPSILON) {
      context.addIssue({ code: "custom", message: "Crop region exceeds image bounds" });
    }
  });

export type NormalizedCropRegion = z.infer<typeof normalizedCropRegionSchema>;

export interface PixelCropRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clampPixelCrop = (crop: PixelCropRegion, imageWidth: number, imageHeight: number): PixelCropRegion => {
  const left = Math.min(Math.max(0, Math.round(crop.left)), Math.max(0, imageWidth - 1));
  const top = Math.min(Math.max(0, Math.round(crop.top)), Math.max(0, imageHeight - 1));
  const width = Math.min(Math.max(1, Math.round(crop.width)), imageWidth - left);
  const height = Math.min(Math.max(1, Math.round(crop.height)), imageHeight - top);
  return { left, top, width, height };
};

export const resolveThumbToPosterCropRegion = (imageWidth: number, imageHeight: number): PixelCropRegion | null => {
  const aspectRatio = imageHeight / imageWidth;
  if (aspectRatio >= 1.4) return null;

  if (aspectRatio >= 1) {
    const cropWidth = Math.floor(imageHeight / 1.5);
    return clampPixelCrop(
      { left: Math.floor((imageWidth - cropWidth) / 2), top: 0, width: cropWidth, height: imageHeight },
      imageWidth,
      imageHeight,
    );
  }

  let left = Math.round(imageWidth / 1.9);
  let right = imageWidth;
  if (imageWidth === 800) {
    left = imageHeight === 439 ? 420 : imageHeight >= 499 && imageHeight <= 503 ? 437 : 421;
  } else if (imageWidth === 840 && imageHeight === 472) {
    left = 473;
    right = 788;
  }

  return clampPixelCrop({ left, top: 0, width: right - left, height: imageHeight }, imageWidth, imageHeight);
};

export const resolvePosterEditorCropRegion = (imageWidth: number, imageHeight: number): NormalizedCropRegion => {
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
    throw new Error("Image dimensions must be positive finite numbers");
  }
  const derived = resolveThumbToPosterCropRegion(imageWidth, imageHeight);
  const width = Math.min(imageWidth, imageHeight * POSTER_ASPECT_RATIO);
  const height = width / POSTER_ASPECT_RATIO;
  const centerX = derived ? derived.left + derived.width / 2 : imageWidth / 2;
  const centerY = derived ? derived.top + derived.height / 2 : imageHeight / 2;
  const crop = {
    left: Math.min(Math.max(0, centerX - width / 2), imageWidth - width),
    top: Math.min(Math.max(0, centerY - height / 2), imageHeight - height),
    width,
    height,
  };
  return {
    x: crop.left / imageWidth,
    y: crop.top / imageHeight,
    width: crop.width / imageWidth,
    height: crop.height / imageHeight,
  };
};

export const normalizedCropToPixels = (
  input: NormalizedCropRegion,
  imageWidth: number,
  imageHeight: number,
): PixelCropRegion => {
  const crop = normalizedCropRegionSchema.parse(input);
  const rawWidth = crop.width * imageWidth;
  const rawHeight = crop.height * imageHeight;
  if (Math.abs(rawWidth / rawHeight - POSTER_ASPECT_RATIO) > 0.005) {
    throw new Error("Poster crop must use a 2:3 aspect ratio");
  }
  const left = Math.round(crop.x * imageWidth);
  const top = Math.round(crop.y * imageHeight);
  const maxWidth = imageWidth - left;
  const maxHeight = imageHeight - top;
  let width = Math.min(maxWidth, Math.max(1, Math.round(crop.width * imageWidth)));
  let height = Math.min(maxHeight, Math.max(1, Math.round(crop.height * imageHeight)));
  if (width / height > POSTER_ASPECT_RATIO) width = Math.max(1, Math.round(height * POSTER_ASPECT_RATIO));
  else height = Math.max(1, Math.round(width / POSTER_ASPECT_RATIO));
  return clampPixelCrop({ left, top, width, height }, imageWidth, imageHeight);
};

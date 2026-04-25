import { randomUUID } from "node:crypto";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, extname, join, parse } from "node:path";
import type { PosterBadgeDefinition } from "@main/utils/movieTags";
import {
  POSTER_TAG_BADGE_ASPECT_RATIO,
  POSTER_TAG_BADGE_IMAGE_EXTENSIONS,
  POSTER_TAG_BADGE_IMAGE_FILENAMES,
  POSTER_TAG_BADGE_MAX_WIDTH,
  POSTER_TAG_BADGE_MAX_WIDTH_RATIO,
  POSTER_TAG_BADGE_MIN_WIDTH,
  POSTER_TAG_BADGE_WIDTH_RATIO,
  type PosterTagBadgePosition,
} from "@shared/posterBadges";
import { app } from "electron";
import sharp from "sharp";

const WATERMARK_DIRECTORY_NAME = "watermark";
const BADGE_GAP_RATIO = 0.1;
const FONT_STACK = [
  "'Microsoft YaHei'",
  "'PingFang SC'",
  "'Noto Sans CJK SC'",
  "'Noto Sans SC'",
  "'Source Han Sans SC'",
  "'WenQuanYi Zen Hei'",
  "sans-serif",
].join(", ");

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

interface BadgeOverlayLayout {
  badgeWidth: number;
  badgeHeight: number;
  badgeGap: number;
  overlayHeight: number;
}

interface BadgeOverlayRenderResult {
  svg: string;
  width: number;
  height: number;
}

interface BadgeOverlayInput {
  input: Buffer;
  left: number;
  top: number;
}

export interface PosterWatermarkOptions {
  imageOverrides?: boolean;
  onWarn?: (message: string) => void;
  watermarkDirectory?: string;
}

const inferOutputExtension = (filePath: string, format: string | undefined): string => {
  const currentExtension = extname(filePath);
  if (currentExtension) {
    return currentExtension;
  }

  switch (format) {
    case "png":
      return ".png";
    case "webp":
      return ".webp";
    default:
      return ".jpg";
  }
};

const buildBadgeMarkup = (
  badge: PosterBadgeDefinition,
  index: number,
  badgeWidth: number,
  badgeHeight: number,
  badgeGap: number,
): string => {
  const tailWidth = Math.max(14, Math.round(badgeWidth * 0.15));
  const bodyWidth = badgeWidth - tailWidth;
  const halfHeight = Math.round(badgeHeight / 2);
  const fontSize = clamp(Math.round(badgeHeight * 0.46), 18, 34);
  const highlightWidth = Math.max(12, Math.round(bodyWidth * 0.18));
  const baselineY = Math.round(badgeHeight * 0.68);
  const groupY = index * (badgeHeight + badgeGap);

  return `
    <g transform="translate(0 ${groupY})">
      <defs>
        <linearGradient id="badge-fill-${badge.id}" x1="0" y1="0" x2="${badgeWidth}" y2="${badgeHeight}" gradientUnits="userSpaceOnUse">
          <stop stop-color="${badge.colorStart}" />
          <stop offset="1" stop-color="${badge.colorEnd}" />
        </linearGradient>
      </defs>
      <path d="M0 0H${bodyWidth}L${badgeWidth} ${halfHeight}L${bodyWidth} ${badgeHeight}H0V0Z" fill="url(#badge-fill-${badge.id})" />
      <path d="M${bodyWidth} 0L${badgeWidth} ${halfHeight}L${bodyWidth} ${badgeHeight}" stroke="${badge.accentColor}" stroke-opacity="0.5" stroke-width="2" />
      <path d="M0 0H${bodyWidth}L${badgeWidth} ${halfHeight}H${highlightWidth}L0 0Z" fill="white" fill-opacity="0.12" />
      <text
        x="${Math.round(bodyWidth / 2)}"
        y="${baselineY}"
        text-anchor="middle"
        font-size="${fontSize}"
        font-weight="800"
        fill="white"
        font-family="${FONT_STACK}"
        letter-spacing="${Math.max(0, Math.round(fontSize * 0.06))}"
      >
        ${badge.label}
      </text>
    </g>
  `;
};

const resolveBadgeOverlayLayout = (
  posterWidth: number,
  posterHeight: number,
  badgeCount: number,
): BadgeOverlayLayout => {
  const maxPosterWidth = Math.max(1, Math.round(posterWidth));
  const maxPosterHeight = Math.max(1, Math.round(posterHeight));
  const maxCoverageWidth = Math.max(1, Math.round(posterWidth * POSTER_TAG_BADGE_MAX_WIDTH_RATIO));
  let badgeWidth = Math.min(
    clamp(
      Math.round(posterWidth * POSTER_TAG_BADGE_WIDTH_RATIO),
      POSTER_TAG_BADGE_MIN_WIDTH,
      POSTER_TAG_BADGE_MAX_WIDTH,
    ),
    maxPosterWidth,
    maxCoverageWidth,
  );
  let badgeHeight = Math.max(1, Math.round(badgeWidth / POSTER_TAG_BADGE_ASPECT_RATIO));
  let badgeGap = badgeCount > 1 ? Math.max(1, Math.round(badgeHeight * BADGE_GAP_RATIO)) : 0;
  let overlayHeight = badgeHeight * badgeCount + badgeGap * Math.max(0, badgeCount - 1);

  while (overlayHeight > maxPosterHeight && badgeWidth > 1) {
    badgeWidth -= 1;
    badgeHeight = Math.max(1, Math.round(badgeWidth / POSTER_TAG_BADGE_ASPECT_RATIO));
    badgeGap = badgeCount > 1 ? Math.max(0, Math.round(badgeHeight * BADGE_GAP_RATIO)) : 0;
    overlayHeight = badgeHeight * badgeCount + badgeGap * Math.max(0, badgeCount - 1);
  }

  return {
    badgeWidth,
    badgeHeight,
    badgeGap,
    overlayHeight: Math.min(overlayHeight, maxPosterHeight),
  };
};

const buildGeneratedBadgeOverlaySvg = (
  badge: PosterBadgeDefinition,
  badgeWidth: number,
  badgeHeight: number,
): BadgeOverlayRenderResult => {
  return {
    svg: `
      <svg width="${badgeWidth}" height="${badgeHeight}" viewBox="0 0 ${badgeWidth} ${badgeHeight}" fill="none" xmlns="http://www.w3.org/2000/svg">
        ${buildBadgeMarkup(badge, 0, badgeWidth, badgeHeight, 0)}
      </svg>
    `,
    width: badgeWidth,
    height: badgeHeight,
  };
};

const resolveBadgeOverlayPlacement = (
  posterWidth: number,
  posterHeight: number,
  overlayWidth: number,
  overlayHeight: number,
  position: PosterTagBadgePosition,
): { left: number; top: number } => {
  const left = position.endsWith("Right") ? Math.max(0, posterWidth - overlayWidth) : 0;
  const top = position.startsWith("bottom") ? Math.max(0, posterHeight - overlayHeight) : 0;

  return { left, top };
};

const resolveDefaultWatermarkDirectory = (): string => join(app.getPath("userData"), WATERMARK_DIRECTORY_NAME);

const isExistingFile = async (filePath: string): Promise<boolean> => {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
};

const resolveCustomBadgeImagePath = async (
  badge: PosterBadgeDefinition,
  watermarkDirectory: string,
): Promise<string | null> => {
  const basenames = POSTER_TAG_BADGE_IMAGE_FILENAMES[badge.id] ?? [badge.id, badge.label];

  for (const basename of basenames) {
    for (const extension of POSTER_TAG_BADGE_IMAGE_EXTENSIONS) {
      const candidate = join(watermarkDirectory, `${basename}.${extension}`);
      if (await isExistingFile(candidate)) {
        return candidate;
      }
    }
  }

  return null;
};

const renderCustomBadgeImage = async (imagePath: string, badgeWidth: number, badgeHeight: number): Promise<Buffer> =>
  await sharp(imagePath, { animated: false })
    .rotate()
    .resize({
      width: badgeWidth,
      height: badgeHeight,
      fit: "contain",
      position: "left",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

const renderGeneratedBadgeImage = (badge: PosterBadgeDefinition, badgeWidth: number, badgeHeight: number): Buffer => {
  const overlay = buildGeneratedBadgeOverlaySvg(badge, badgeWidth, badgeHeight);
  return Buffer.from(overlay.svg);
};

const renderBadgeImage = async (
  badge: PosterBadgeDefinition,
  badgeWidth: number,
  badgeHeight: number,
  options: PosterWatermarkOptions,
): Promise<Buffer> => {
  if (!options.imageOverrides) {
    return renderGeneratedBadgeImage(badge, badgeWidth, badgeHeight);
  }

  const watermarkDirectory = options.watermarkDirectory ?? resolveDefaultWatermarkDirectory();
  const imagePath = await resolveCustomBadgeImagePath(badge, watermarkDirectory);
  if (!imagePath) {
    return renderGeneratedBadgeImage(badge, badgeWidth, badgeHeight);
  }

  try {
    return await renderCustomBadgeImage(imagePath, badgeWidth, badgeHeight);
  } catch (error) {
    options.onWarn?.(
      `Failed to apply custom poster badge image for ${badge.id} from ${imagePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return renderGeneratedBadgeImage(badge, badgeWidth, badgeHeight);
  }
};

const buildBadgeOverlayInputs = async (
  posterWidth: number,
  posterHeight: number,
  badges: readonly PosterBadgeDefinition[],
  position: PosterTagBadgePosition,
  options: PosterWatermarkOptions,
): Promise<BadgeOverlayInput[]> => {
  const layout = resolveBadgeOverlayLayout(posterWidth, posterHeight, badges.length);
  const placement = resolveBadgeOverlayPlacement(
    posterWidth,
    posterHeight,
    layout.badgeWidth,
    layout.overlayHeight,
    position,
  );

  const overlays = await Promise.all(
    badges.map(async (badge, index) => ({
      input: await renderBadgeImage(badge, layout.badgeWidth, layout.badgeHeight, options),
      left: placement.left,
      top: placement.top + index * (layout.badgeHeight + layout.badgeGap),
    })),
  );

  return overlays.filter((overlay) => overlay.top < posterHeight && overlay.left < posterWidth);
};

export class PosterWatermarkService {
  async applyTagBadges(
    posterPath: string,
    badges: readonly PosterBadgeDefinition[],
    position: PosterTagBadgePosition = "topLeft",
    options: PosterWatermarkOptions = {},
  ): Promise<void> {
    if (badges.length === 0) {
      return;
    }

    let pipeline = sharp(posterPath, { animated: false });
    const metadata = await pipeline.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (width <= 0 || height <= 0) {
      throw new Error(`Unable to read poster dimensions for ${posterPath}`);
    }

    const parsedPath = parse(posterPath);
    const outputExtension = inferOutputExtension(posterPath, metadata.format);
    const tempPath = join(parsedPath.dir, `${parsedPath.name}.tag-badges.${randomUUID()}${outputExtension}`);
    await mkdir(dirname(tempPath), { recursive: true });

    try {
      pipeline = pipeline
        .composite(await buildBadgeOverlayInputs(width, height, badges, position, options))
        .keepMetadata();

      switch (metadata.format) {
        case "png":
          pipeline = pipeline.png();
          break;
        case "webp":
          pipeline = pipeline.webp({ quality: 95 });
          break;
        default:
          pipeline = pipeline.jpeg({ quality: 95, chromaSubsampling: "4:4:4" });
          break;
      }

      await pipeline.toFile(tempPath);
      await rename(tempPath, posterPath);
    } finally {
      await unlink(tempPath).catch(() => undefined);
    }
  }
}

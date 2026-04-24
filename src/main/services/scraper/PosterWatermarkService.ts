import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink } from "node:fs/promises";
import { dirname, extname, join, parse } from "node:path";
import type { PosterBadgeDefinition } from "@main/utils/movieTags";
import type { PosterTagBadgePosition } from "@shared/posterBadges";
import sharp from "sharp";

const BADGE_WIDTH_RATIO = 0.24;
const BADGE_MIN_WIDTH = 108;
const BADGE_MAX_WIDTH = 184;
const BADGE_ASPECT_RATIO = 122 / 58;
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
  let badgeWidth = Math.min(
    clamp(Math.round(posterWidth * BADGE_WIDTH_RATIO), BADGE_MIN_WIDTH, BADGE_MAX_WIDTH),
    maxPosterWidth,
  );
  let badgeHeight = Math.max(1, Math.round(badgeWidth / BADGE_ASPECT_RATIO));
  let badgeGap = badgeCount > 1 ? Math.max(1, Math.round(badgeHeight * BADGE_GAP_RATIO)) : 0;
  let overlayHeight = badgeHeight * badgeCount + badgeGap * Math.max(0, badgeCount - 1);

  while (overlayHeight > maxPosterHeight && badgeWidth > 1) {
    badgeWidth -= 1;
    badgeHeight = Math.max(1, Math.round(badgeWidth / BADGE_ASPECT_RATIO));
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

const buildBadgeOverlaySvg = (
  posterWidth: number,
  posterHeight: number,
  badges: readonly PosterBadgeDefinition[],
): BadgeOverlayRenderResult => {
  const { badgeWidth, badgeHeight, badgeGap, overlayHeight } = resolveBadgeOverlayLayout(
    posterWidth,
    posterHeight,
    badges.length,
  );

  return {
    svg: `
      <svg width="${badgeWidth}" height="${overlayHeight}" viewBox="0 0 ${badgeWidth} ${overlayHeight}" fill="none" xmlns="http://www.w3.org/2000/svg">
        ${badges.map((badge, index) => buildBadgeMarkup(badge, index, badgeWidth, badgeHeight, badgeGap)).join("")}
      </svg>
    `,
    width: badgeWidth,
    height: overlayHeight,
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

export class PosterWatermarkService {
  async applyTagBadges(
    posterPath: string,
    badges: readonly PosterBadgeDefinition[],
    position: PosterTagBadgePosition = "topLeft",
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
      const overlay = buildBadgeOverlaySvg(width, height, badges);
      const placement = resolveBadgeOverlayPlacement(width, height, overlay.width, overlay.height, position);
      pipeline = pipeline
        .composite([
          {
            input: Buffer.from(overlay.svg),
            left: placement.left,
            top: placement.top,
          },
        ])
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

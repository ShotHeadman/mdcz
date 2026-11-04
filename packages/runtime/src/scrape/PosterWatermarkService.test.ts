import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  buildBadgeMarkup,
  inferOutputExtension,
  PosterWatermarkService,
  resolveBadgeOverlayLayout,
  resolveBadgeOverlayPlacement,
} from "./PosterWatermarkService";
import type { PosterBadgeDefinition } from "./posterBadges";

const subtitleBadge: PosterBadgeDefinition = {
  id: "subtitle",
  label: "中字",
  colorStart: "#F04A3A",
  colorEnd: "#B91C1C",
  accentColor: "#FFD5D0",
};

const createPoster = async (filePath: string): Promise<void> => {
  await sharp({
    create: {
      width: 400,
      height: 600,
      channels: 3,
      background: { r: 240, g: 240, b: 240 },
    },
  })
    .png()
    .toFile(filePath);
};

describe("PosterWatermarkService pure rendering helpers", () => {
  it("infers output extensions from paths before metadata formats", () => {
    expect(inferOutputExtension("/poster/custom.jpeg", "png")).toBe(".jpeg");
    expect(inferOutputExtension("/poster/no-extension", "png")).toBe(".png");
    expect(inferOutputExtension("/poster/no-extension", "webp")).toBe(".webp");
    expect(inferOutputExtension("/poster/no-extension", "gif")).toBe(".jpg");
    expect(inferOutputExtension("/poster/no-extension", undefined)).toBe(".jpg");
  });

  it("builds positioned badge SVG markup with the definition colors and label", () => {
    const markup = buildBadgeMarkup(subtitleBadge, 2, 120, 60, 6);

    expect(markup).toContain('transform="translate(0 132)"');
    expect(markup).toContain('id="badge-fill-subtitle"');
    expect(markup).toContain('stop-color="#F04A3A"');
    expect(markup).toContain('stop-color="#B91C1C"');
    expect(markup).toContain('stroke="#FFD5D0"');
    expect(markup).toContain("中字");
  });

  it("resolves normal, single-badge, and height-constrained layouts", () => {
    for (const [posterWidth, posterHeight, sizePercent, badgeWidth, badgeHeight, badgeGap, overlayHeight] of [
      [1000, 1500, 100, 160, 80, 8, 256],
      [1500, 1000, 100, 160, 80, 8, 256],
      [400, 600, 100, 64, 32, 3, 102],
      [600, 400, 100, 64, 32, 3, 102],
      [200, 300, 100, 56, 28, 3, 90],
      [400, 600, 200, 128, 64, 6, 204],
      [400, 600, 50, 56, 28, 3, 90],
    ]) {
      expect(resolveBadgeOverlayLayout(posterWidth, posterHeight, 3, sizePercent)).toEqual({
        badgeWidth,
        badgeHeight,
        badgeGap,
        overlayHeight,
      });
    }
    expect(resolveBadgeOverlayLayout(1000, 1500, 1)).toEqual({
      badgeWidth: 160,
      badgeHeight: 80,
      badgeGap: 0,
      overlayHeight: 80,
    });

    const constrained = resolveBadgeOverlayLayout(20, 5, 3);
    expect(constrained.badgeWidth).toBeLessThanOrEqual(20);
    expect(constrained.overlayHeight).toBeLessThanOrEqual(5);
    expect(constrained.badgeHeight).toBeGreaterThan(0);
  });

  it("places overlays at all poster corners without negative offsets", () => {
    expect(resolveBadgeOverlayPlacement(1000, 1500, 184, 294, "topLeft")).toEqual({ left: 0, top: 0 });
    expect(resolveBadgeOverlayPlacement(1000, 1500, 184, 294, "topRight")).toEqual({ left: 816, top: 0 });
    expect(resolveBadgeOverlayPlacement(1000, 1500, 184, 294, "bottomLeft")).toEqual({ left: 0, top: 1206 });
    expect(resolveBadgeOverlayPlacement(100, 100, 184, 294, "bottomRight")).toEqual({ left: 0, top: 0 });
    expect(resolveBadgeOverlayPlacement(1000, 1500, 184, 294, "topLeft", 30)).toEqual({ left: 30, top: 30 });
    expect(resolveBadgeOverlayPlacement(1000, 1500, 184, 294, "bottomRight", 30)).toEqual({ left: 786, top: 1176 });
    expect(resolveBadgeOverlayPlacement(1000, 1500, 184, 294, "topRight", 5000)).toEqual({ left: 0, top: 1206 });
  });
});

describe("PosterWatermarkService", () => {
  it("renders generated tag badges onto a poster while preserving its image format and dimensions", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mdcz-watermark-service-"));
    const posterPath = join(dataDir, "poster.png");
    await createPoster(posterPath);
    const original = await readFile(posterPath);

    await new PosterWatermarkService({ dataDir }).applyTagBadges(posterPath, [subtitleBadge], {
      position: "bottomRight",
    });

    const rendered = await readFile(posterPath);
    const metadata = await sharp(rendered).metadata();
    expect(rendered.equals(original)).toBe(false);
    expect(metadata).toMatchObject({ format: "png", width: 400, height: 600 });
  });

  it("moves badges off the corner by the inset and blends them by the opacity", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mdcz-watermark-style-"));
    const service = new PosterWatermarkService({ dataDir });
    const greenAt = async (options: { insetPercent?: number; opacity?: number }, x: number, y: number) => {
      const posterPath = join(dataDir, `poster-${randomUUID()}.png`);
      await createPoster(posterPath);
      await service.applyTagBadges(posterPath, [subtitleBadge], options);
      const { data, info } = await sharp(posterPath).raw().toBuffer({ resolveWithObject: true });
      return data[(y * info.width + x) * info.channels + 1];
    };

    const opaque = await greenAt({}, 3, 26);
    const translucent = await greenAt({ opacity: 50 }, 3, 26);
    expect(opaque).toBeLessThan(100);
    expect(translucent).toBeGreaterThan(130);
    expect(translucent).toBeLessThan(240);
    expect(await greenAt({ insetPercent: 10 }, 3, 26)).toBe(240);
    expect(await greenAt({ insetPercent: 10 }, 43, 66)).toBeLessThan(100);
  });

  it("renders a preview of the selected badges on a generated sample poster", async () => {
    const service = new PosterWatermarkService({ dataDir: await mkdtemp(join(tmpdir(), "mdcz-watermark-preview-")) });

    const withBadges = await service.renderPreview(["subtitle", "fourK"], {});
    const withoutBadges = await service.renderPreview([], {});

    expect(await sharp(withBadges).metadata()).toMatchObject({ format: "png", width: 800, height: 1200 });
    expect(withBadges.equals(withoutBadges)).toBe(false);
  });

  it("uses valid custom badge images and falls back with a warning for invalid images", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mdcz-watermark-overrides-"));
    const watermarkDirectory = join(dataDir, "watermark");
    await mkdir(watermarkDirectory, { recursive: true });
    const posterPath = join(dataDir, "poster.png");
    const customBadgePath = join(watermarkDirectory, "subtitle.png");
    await createPoster(posterPath);
    await sharp({
      create: {
        width: 120,
        height: 60,
        channels: 4,
        background: { r: 10, g: 20, b: 30, alpha: 1 },
      },
    })
      .png()
      .toFile(customBadgePath);
    const service = new PosterWatermarkService({ dataDir });
    const onWarn = vi.fn();

    await service.applyTagBadges(posterPath, [subtitleBadge], { imageOverrides: true, onWarn });
    expect(onWarn).not.toHaveBeenCalled();

    await writeFile(customBadgePath, "invalid image");
    await service.applyTagBadges(posterPath, [subtitleBadge], { imageOverrides: true, onWarn });
    expect(onWarn).toHaveBeenCalledWith(expect.stringContaining("Failed to apply custom poster badge image"));
  });

  it("does not touch posters when no badges are requested", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mdcz-watermark-empty-"));
    const posterPath = join(dataDir, "poster.png");
    await createPoster(posterPath);
    const original = await readFile(posterPath);

    await new PosterWatermarkService({ dataDir }).applyTagBadges(posterPath, []);

    expect(await readFile(posterPath)).toEqual(original);
  });
});

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  buildBadgeMarkup,
  buildGeneratedBadgeOverlaySvg,
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
    expect(resolveBadgeOverlayLayout(1000, 1500, 3)).toEqual({
      badgeWidth: 184,
      badgeHeight: 92,
      badgeGap: 9,
      overlayHeight: 294,
    });
    expect(resolveBadgeOverlayLayout(1000, 1500, 1)).toEqual({
      badgeWidth: 184,
      badgeHeight: 92,
      badgeGap: 0,
      overlayHeight: 92,
    });

    const constrained = resolveBadgeOverlayLayout(20, 5, 3);
    expect(constrained.badgeWidth).toBeLessThanOrEqual(20);
    expect(constrained.overlayHeight).toBeLessThanOrEqual(5);
    expect(constrained.badgeHeight).toBeGreaterThan(0);
  });

  it("builds a standalone generated overlay SVG", () => {
    const overlay = buildGeneratedBadgeOverlaySvg(subtitleBadge, 120, 60);

    expect(overlay).toMatchObject({ width: 120, height: 60 });
    expect(overlay.svg).toContain('<svg width="120" height="60" viewBox="0 0 120 60"');
    expect(overlay.svg).toContain("badge-fill-subtitle");
    expect(overlay.svg).toContain("中字");
  });

  it("places overlays at all poster corners without negative offsets", () => {
    expect(resolveBadgeOverlayPlacement(1000, 1500, 184, 294, "topLeft")).toEqual({ left: 0, top: 0 });
    expect(resolveBadgeOverlayPlacement(1000, 1500, 184, 294, "topRight")).toEqual({ left: 816, top: 0 });
    expect(resolveBadgeOverlayPlacement(1000, 1500, 184, 294, "bottomLeft")).toEqual({ left: 0, top: 1206 });
    expect(resolveBadgeOverlayPlacement(100, 100, 184, 294, "bottomRight")).toEqual({ left: 0, top: 0 });
  });
});

describe("PosterWatermarkService", () => {
  it("renders generated tag badges onto a poster while preserving its image format and dimensions", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mdcz-watermark-service-"));
    const posterPath = join(dataDir, "poster.png");
    await createPoster(posterPath);
    const original = await readFile(posterPath);

    await new PosterWatermarkService({ dataDir }).applyTagBadges(posterPath, [subtitleBadge], "bottomRight");

    const rendered = await readFile(posterPath);
    const metadata = await sharp(rendered).metadata();
    expect(rendered.equals(original)).toBe(false);
    expect(metadata).toMatchObject({ format: "png", width: 400, height: 600 });
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

    await service.applyTagBadges(posterPath, [subtitleBadge], "topLeft", { imageOverrides: true, onWarn });
    expect(onWarn).not.toHaveBeenCalled();

    await writeFile(customBadgePath, "invalid image");
    await service.applyTagBadges(posterPath, [subtitleBadge], "topLeft", { imageOverrides: true, onWarn });
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

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PosterWatermarkService } from "@main/services/scraper/PosterWatermarkService";
import type { PosterBadgeDefinition } from "@main/utils/movieTags";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-poster-watermark-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const subtitleBadge: PosterBadgeDefinition = {
  id: "subtitle",
  label: "中字",
  colorStart: "#F04A3A",
  colorEnd: "#B91C1C",
  accentColor: "#FFD5D0",
};

const readPixel = async (filePath: string, left: number, top: number): Promise<number[]> => {
  const { data } = await sharp(filePath)
    .extract({ left, top, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });

  return Array.from(data);
};

describe("PosterWatermarkService", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
    );
  });

  it("adds stacked tag badges without changing the poster dimensions", async () => {
    const root = await createTempDir();
    const posterPath = join(root, "poster.png");
    await sharp({
      create: {
        width: 320,
        height: 480,
        channels: 4,
        background: "#808080",
      },
    })
      .png()
      .toFile(posterPath);

    const badges: PosterBadgeDefinition[] = [
      subtitleBadge,
      {
        id: "leak",
        label: "流出",
        colorStart: "#2B6CB0",
        colorEnd: "#1E3A5F",
        accentColor: "#D6E8FF",
      },
    ];

    await new PosterWatermarkService().applyTagBadges(posterPath, badges);

    const metadata = await sharp(posterPath).metadata();
    expect(metadata.width).toBe(320);
    expect(metadata.height).toBe(480);
    expect(await readFile(posterPath)).not.toHaveLength(0);
    expect(await readPixel(posterPath, 12, 12)).not.toEqual([128, 128, 128, 255]);
    expect(await readPixel(posterPath, 12, 72)).not.toEqual([128, 128, 128, 255]);
  });

  it("scales badges down for narrow posters instead of failing the composite step", async () => {
    const root = await createTempDir();
    const posterPath = join(root, "narrow-poster.png");
    await sharp({
      create: {
        width: 20,
        height: 40,
        channels: 4,
        background: "#808080",
      },
    })
      .png()
      .toFile(posterPath);

    await expect(new PosterWatermarkService().applyTagBadges(posterPath, [subtitleBadge])).resolves.toBeUndefined();

    const metadata = await sharp(posterPath).metadata();
    expect(metadata.width).toBe(20);
    expect(metadata.height).toBe(40);
  });

  it("preserves image metadata when rewriting the poster", async () => {
    const root = await createTempDir();
    const posterPath = join(root, "poster.jpg");
    await sharp({
      create: {
        width: 200,
        height: 400,
        channels: 3,
        background: "#808080",
      },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toFile(posterPath);

    await new PosterWatermarkService().applyTagBadges(posterPath, [subtitleBadge]);

    const metadata = await sharp(posterPath).metadata();
    expect(metadata.orientation).toBe(6);
    expect(metadata.icc).toBeDefined();
  });

  it("places stacked tag badges in the configured poster corner", async () => {
    const service = new PosterWatermarkService();
    const cases = [
      { position: "topLeft" as const, activePoint: [12, 12], inactivePoint: [240, 440] },
      { position: "topRight" as const, activePoint: [240, 12], inactivePoint: [12, 440] },
      { position: "bottomLeft" as const, activePoint: [12, 440], inactivePoint: [240, 12] },
      { position: "bottomRight" as const, activePoint: [240, 440], inactivePoint: [12, 12] },
    ];

    for (const { position, activePoint, inactivePoint } of cases) {
      const root = await createTempDir();
      const posterPath = join(root, `${position}.png`);
      await sharp({
        create: {
          width: 320,
          height: 480,
          channels: 4,
          background: "#808080",
        },
      })
        .png()
        .toFile(posterPath);

      await service.applyTagBadges(posterPath, [subtitleBadge], position);

      expect(await readPixel(posterPath, activePoint[0], activePoint[1])).not.toEqual([128, 128, 128, 255]);
      expect(await readPixel(posterPath, inactivePoint[0], inactivePoint[1])).toEqual([128, 128, 128, 255]);
    }
  });
});

import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PosterImageDerivationService,
  resolveThumbToPosterCropRegion,
} from "@main/services/scraper/download/PosterImageDerivationService";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-poster-derivation-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const writeRandomJpeg = async (filePath: string, width: number, height: number): Promise<void> => {
  await sharp(randomBytes(width * height * 3), {
    raw: {
      width,
      height,
      channels: 3,
    },
  })
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
    .toFile(filePath);
};

const writeSmallPoster = async (filePath: string): Promise<void> => {
  await sharp({
    create: {
      width: 147,
      height: 200,
      channels: 3,
      background: "#7799cc",
    },
  })
    .jpeg({ quality: 80 })
    .toFile(filePath);
};

const createSubject = () => {
  const logger = { warn: vi.fn() };
  return {
    logger,
    service: new PosterImageDerivationService(logger),
  };
};

describe("PosterImageDerivationService", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map(async (dirPath) => {
        await rm(dirPath, { recursive: true, force: true });
      }),
    );
  });

  it("uses the DMM landscape right crop for 800x538 thumbs", async () => {
    const root = await createTempDir();
    const thumbPath = join(root, "thumb.jpg");
    const posterPath = join(root, "poster.jpg");
    await writeRandomJpeg(thumbPath, 800, 538);
    await writeSmallPoster(posterPath);

    const { service } = createSubject();
    const result = await service.deriveFromThumbIfNeeded({
      posterPath,
      targetPath: posterPath,
      thumbPath,
    });

    expect(result).toEqual({ status: "derived", path: posterPath });
    await expect(sharp(posterPath).metadata()).resolves.toMatchObject({
      width: 379,
      height: 538,
      format: "jpeg",
    });
    expect((await stat(posterPath)).size).toBeGreaterThan(50_000);
  });

  it("uses a centered crop for near-square thumbs", async () => {
    const root = await createTempDir();
    const thumbPath = join(root, "thumb.jpg");
    const posterPath = join(root, "poster.jpg");
    await writeRandomJpeg(thumbPath, 600, 720);
    await writeSmallPoster(posterPath);

    const { service } = createSubject();
    await expect(
      service.deriveFromThumbIfNeeded({
        posterPath,
        targetPath: posterPath,
        thumbPath,
      }),
    ).resolves.toEqual({ status: "derived", path: posterPath });

    await expect(sharp(posterPath).metadata()).resolves.toMatchObject({
      width: 480,
      height: 720,
      format: "jpeg",
    });
  });

  it("skips portrait thumbs without changing an existing poster", async () => {
    const root = await createTempDir();
    const thumbPath = join(root, "thumb.jpg");
    const posterPath = join(root, "poster.jpg");
    await writeRandomJpeg(thumbPath, 200, 300);
    await writeSmallPoster(posterPath);
    const before = await readFile(posterPath);

    const { service } = createSubject();
    await expect(
      service.deriveFromThumbIfNeeded({
        posterPath,
        targetPath: posterPath,
        thumbPath,
      }),
    ).resolves.toEqual({ status: "skipped", reason: "portrait_thumb" });

    await expect(readFile(posterPath)).resolves.toEqual(before);
  });

  it("skips posters at or above the size threshold byte-for-byte", async () => {
    const root = await createTempDir();
    const thumbPath = join(root, "thumb.jpg");
    const posterPath = join(root, "poster.jpg");
    await writeRandomJpeg(thumbPath, 800, 538);
    await writeRandomJpeg(posterPath, 400, 700);
    expect((await stat(posterPath)).size).toBeGreaterThanOrEqual(50_000);
    const before = await readFile(posterPath);

    const { service } = createSubject();
    await expect(
      service.deriveFromThumbIfNeeded({
        posterPath,
        targetPath: posterPath,
        thumbPath,
      }),
    ).resolves.toEqual({ status: "skipped", reason: "large_poster" });

    await expect(readFile(posterPath)).resolves.toEqual(before);
  });

  it("skips missing thumbs without throwing", async () => {
    const root = await createTempDir();
    const posterPath = join(root, "poster.jpg");
    await writeSmallPoster(posterPath);

    const { logger, service } = createSubject();
    await expect(
      service.deriveFromThumbIfNeeded({
        posterPath,
        targetPath: posterPath,
        thumbPath: undefined,
      }),
    ).resolves.toEqual({ status: "skipped", reason: "missing_thumb" });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("thumb asset is missing"));
  });

  it("documents the special right-crop dimensions", () => {
    expect(resolveThumbToPosterCropRegion(840, 472)).toEqual({
      left: 473,
      top: 0,
      width: 315,
      height: 472,
    });
  });
});

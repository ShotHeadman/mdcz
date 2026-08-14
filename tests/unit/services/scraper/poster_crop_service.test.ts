import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PosterCropService } from "@mdcz/runtime/scrape";
import { describe, expect, it } from "vitest";

const testImage = (width: number, height: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#c84630"/></svg>`;

describe("PosterCropService", () => {
  it("prepares from thumb and atomically writes a 2:3 poster", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-poster-crop-"));
    const videoPath = join(root, "ABC-123.mp4");
    const thumbPath = join(root, "thumb.jpg");
    await writeFile(videoPath, "video");
    await writeFile(thumbPath, testImage(900, 500));
    const service = new PosterCropService();
    const session = await service.prepare(videoPath, "fixed");
    expect(session.sourcePath).toBe(thumbPath);
    expect((session.initialCrop.width * session.width) / (session.initialCrop.height * session.height)).toBeCloseTo(
      2 / 3,
      3,
    );

    await service.save(videoPath, "fixed", session.initialCrop);
    await rm(thumbPath);
    const saved = await service.prepare(videoPath, "fixed");
    expect(saved.width / saved.height).toBeCloseTo(2 / 3, 2);
  });

  it("leaves the previous poster unchanged when crop validation fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-poster-crop-"));
    const videoPath = join(root, "ABC-123.mp4");
    const thumbPath = join(root, "thumb.jpg");
    const posterPath = join(root, "poster.jpg");
    await writeFile(videoPath, "video");
    await writeFile(thumbPath, testImage(900, 500));
    await writeFile(posterPath, "existing-poster");
    const service = new PosterCropService();
    await expect(service.save(videoPath, "fixed", { x: 0.9, y: 0, width: 0.5, height: 0.75 })).rejects.toThrow();
    await expect(readFile(posterPath, "utf8")).resolves.toBe("existing-poster");
  });

  it("uses follow-video asset names", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-poster-crop-"));
    const videoPath = join(root, "ABC-123.mp4");
    await writeFile(videoPath, "video");
    await writeFile(join(root, "ABC-123-thumb.jpg"), testImage(400, 600));
    const session = await new PosterCropService().prepare(videoPath, "followVideo");
    expect(session.targetPath).toBe(join(root, "ABC-123-poster.jpg"));
  });

  it("preserves an existing poster image extension", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-poster-crop-"));
    const videoPath = join(root, "ABC-123.mp4");
    await writeFile(videoPath, "video");
    await writeFile(join(root, "thumb.png"), testImage(900, 500));
    await writeFile(join(root, "poster.png"), testImage(400, 600));
    const session = await new PosterCropService().prepare(videoPath, "fixed");
    expect(session.sourcePath).toBe(join(root, "thumb.png"));
    expect(session.targetPath).toBe(join(root, "poster.png"));
  });

  it("rejects sessions without a local image source", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-poster-crop-"));
    const videoPath = join(root, "ABC-123.mp4");
    await writeFile(videoPath, "video");
    await expect(new PosterCropService().prepare(videoPath, "fixed")).rejects.toThrow("No local thumb or poster");
  });
});

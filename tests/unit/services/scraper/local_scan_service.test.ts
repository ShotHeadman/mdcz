import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalScanService } from "@main/services/scraper/maintenance/LocalScanService";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-local-scan-"));
  tempDirs.push(dirPath);
  return dirPath;
};

describe("LocalScanService", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
    );
  });

  it("skips generated trailer sidecars when scanning for maintenance entries", async () => {
    const root = await createTempDir();
    const movieDir = join(root, "ABC-123");
    const videoPath = join(movieDir, "ABC-123.mp4");
    const trailerPath = join(movieDir, "trailer.mp4");

    await mkdir(movieDir, { recursive: true });
    await writeFile(videoPath, "video");
    await writeFile(trailerPath, "trailer");

    const entries = await new LocalScanService().scan(root, "extrafanart");

    expect(entries).toHaveLength(1);
    expect(entries[0]?.videoPath).toBe(videoPath);
    expect(entries[0]?.assets.trailer).toBe(trailerPath);
  });

  it("returns no entries when a directory only contains generated trailer sidecars", async () => {
    const root = await createTempDir();

    await writeFile(join(root, "trailer.mp4"), "trailer");

    const entries = await new LocalScanService().scan(root, "extrafanart");

    expect(entries).toEqual([]);
  });
});

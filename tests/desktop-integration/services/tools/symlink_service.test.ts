import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SignalService } from "@main/services/SignalService";
import { SymlinkService } from "@main/services/tools/SymlinkService";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-symlink-service-"));
  tempDirs.push(dirPath);
  return dirPath;
};

describe("SymlinkService", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map(async (dirPath) => {
        await rm(dirPath, { recursive: true, force: true });
      }),
    );
  });

  it("counts skipped sidecar files when copyFiles is disabled", async () => {
    const sourceDir = await createTempDir();
    const destDir = await createTempDir();
    await writeFile(join(sourceDir, "movie.srt"), "subtitle", "utf8");

    const signalService = {
      showLogText: vi.fn(),
    } as unknown as SignalService;

    const result = await new SymlinkService({ signalService }).run({
      sourceDir,
      destDir,
      copyFiles: false,
    });

    expect(result).toEqual({
      total: 1,
      linked: 0,
      copied: 0,
      skipped: 1,
      failed: 0,
    });
  });

  it("copies relative .strm files instead of symlinking them", async () => {
    const sourceDir = await createTempDir();
    const destDir = await createTempDir();
    const sourcePath = join(sourceDir, "movie.strm");
    const destPath = join(destDir, "movie.strm");
    await writeFile(sourcePath, "../videos/movie.mp4", "utf8");

    const signalService = {
      showLogText: vi.fn(),
    } as unknown as SignalService;

    const result = await new SymlinkService({ signalService }).run({
      sourceDir,
      destDir,
      copyFiles: false,
    });

    expect(result).toEqual({
      total: 1,
      linked: 0,
      copied: 1,
      skipped: 0,
      failed: 0,
    });
    await expect(readFile(destPath, "utf8")).resolves.toBe("../videos/movie.mp4");
    await expect(lstat(destPath)).resolves.toMatchObject({
      isSymbolicLink: expect.any(Function),
    });
    expect((await lstat(destPath)).isSymbolicLink()).toBe(false);
  });
});

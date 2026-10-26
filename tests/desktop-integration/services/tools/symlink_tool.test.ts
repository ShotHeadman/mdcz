import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createSymlinks } from "@mdcz/runtime/tools";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-symlink-service-"));
  tempDirs.push(dirPath);
  return dirPath;
};

describe("symlink tool", () => {
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

    const result = await createSymlinks({ sourceDir, destDir, copyFiles: false });

    expect(result).toMatchObject({
      total: 1,
      linked: 0,
      copied: 0,
      skipped: 1,
      failed: 0,
    });
  });

  it.each([
    true,
    false,
  ])("reanchors external relative STRM targets and reports invalid files (valid: %s)", async (valid) => {
    const sourceDir = await createTempDir();
    const destDir = await createTempDir();
    const sourcePath = join(sourceDir, "movie.strm");
    const destPath = join(destDir, "movie.strm");
    const videoPath = join(await createTempDir(), "movie.mp4");
    await writeFile(videoPath, "video");
    const content = valid
      ? `\uFEFF#KODIPROP:inputstream=inputstream.adaptive\r\n${relative(sourceDir, videoPath)}\r\n`
      : "";
    await writeFile(sourcePath, content, "utf8");

    const result = await createSymlinks({ sourceDir, destDir, copyFiles: false });

    expect(result).toMatchObject({
      total: 1,
      linked: 0,
      copied: valid ? 1 : 0,
      skipped: 0,
      failed: valid ? 0 : 1,
    });
    if (!valid) {
      await expect(readFile(destPath)).rejects.toMatchObject({ code: "ENOENT" });
      return;
    }
    await expect(readFile(destPath, "utf8")).resolves.toBe(content.replace(relative(sourceDir, videoPath), videoPath));
    await expect(readFile(videoPath, "utf8")).resolves.toBe("video");
    await expect(lstat(destPath)).resolves.toMatchObject({
      isSymbolicLink: expect.any(Function),
    });
    expect((await lstat(destPath)).isSymbolicLink()).toBe(false);
  });
});

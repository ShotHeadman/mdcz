import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listVideoFiles } from "@main/utils/file";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-file-test-"));
  tempDirs.push(dirPath);
  return dirPath;
};

describe("listVideoFiles", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map(async (dirPath) => {
        await rm(dirPath, { recursive: true, force: true });
      }),
    );
  });

  it("includes .strm files in scan results", async () => {
    const root = await createTempDir();
    await writeFile(join(root, "ABC-123.strm"), "https://example.com/stream.m3u8", "utf8");
    await writeFile(join(root, "DEF-456.mp4"), "stub", "utf8");
    await writeFile(join(root, "ignore.txt"), "stub", "utf8");

    const files = await listVideoFiles(root, false);
    const names = files.map((filePath) => filePath.split(/[\\/]+/u).at(-1)).sort();

    expect(names).toEqual(["ABC-123.strm", "DEF-456.mp4"]);
  });

  it("finds nested .strm files when recursive is enabled", async () => {
    const root = await createTempDir();
    const nested = join(root, "nested");
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, "GHI-789.strm"), "https://example.com/stream2.m3u8", "utf8");

    const files = await listVideoFiles(root, true);
    const names = files.map((filePath) => filePath.split(/[\\/]+/u).at(-1)).sort();

    expect(names).toEqual(["GHI-789.strm"]);
  });
});

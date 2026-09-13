import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { listVideoFiles } from "@main/utils/file";
import { afterEach, describe, expect, it, vi } from "vitest";

type FileUtilsModule = typeof import("@mdcz/runtime/scrape/utils/filesystem");
type FileSystemOverrides = {
  rename?: (sourcePath: string, targetPath: string) => Promise<void>;
  copyFile?: (sourcePath: string, targetPath: string) => Promise<void>;
};

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-file-test-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const createNodeError = (code: string, message = code): NodeJS.ErrnoException => {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
};

const importRuntimeFileUtils = async (overrides: FileSystemOverrides): Promise<FileUtilsModule> => {
  vi.resetModules();
  vi.doMock("node:fs/promises", async () => {
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    return {
      ...actual,
      rename: overrides.rename ?? actual.rename,
      copyFile: overrides.copyFile ?? actual.copyFile,
    };
  });

  return await import("@mdcz/runtime/scrape/utils/filesystem");
};

const expectNoPartialFiles = async (targetPath: string): Promise<void> => {
  const entries = await readdir(dirname(targetPath));
  expect(entries.some((entry) => entry.endsWith(".part"))).toBe(false);
};

afterEach(async () => {
  vi.doUnmock("node:fs/promises");
  vi.resetModules();
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
  );
});

describe("listVideoFiles", () => {
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

describe("moveFileSafely", () => {
  it("uses rename without copying when the paths share a filesystem", async () => {
    const root = await createTempDir();
    const sourcePath = join(root, "source.mp4");
    const targetPath = join(root, "output", "movie.mp4");
    const rename = vi.fn(async (source: string, target: string) => {
      await rm(target, { force: true });
      await writeFile(target, await readFile(source));
      await rm(source);
    });
    const copyFile = vi.fn();
    const { moveFileSafely } = await importRuntimeFileUtils({ rename, copyFile });

    await writeFile(sourcePath, "video", "utf8");

    await expect(moveFileSafely(sourcePath, targetPath)).resolves.toBe(targetPath);

    expect(rename).toHaveBeenCalledWith(sourcePath, targetPath);
    expect(copyFile).not.toHaveBeenCalled();
    await expect(readFile(targetPath, "utf8")).resolves.toBe("video");
    await expect(access(sourcePath)).rejects.toThrow();
  });

  it("cleans a failed copy part without deleting the source", async () => {
    const root = await createTempDir();
    const sourcePath = join(root, "source.mp4");
    const targetPath = join(root, "output", "movie.mp4");
    const { moveFileSafely } = await importRuntimeFileUtils({
      rename: async () => {
        throw createNodeError("EXDEV");
      },
      copyFile: async (_sourcePath, destinationPath) => {
        await writeFile(destinationPath, "partial", "utf8");
        throw createNodeError("EIO", "copy failed");
      },
    });

    await writeFile(sourcePath, "video", "utf8");

    await expect(moveFileSafely(sourcePath, targetPath)).rejects.toThrow("copy failed");
    await expect(readFile(sourcePath, "utf8")).resolves.toBe("video");
    await expect(access(targetPath)).rejects.toThrow();
    await expectNoPartialFiles(targetPath);
  });
});

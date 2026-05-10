import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type FileUtilsModule = typeof import("@mdcz/runtime/scrape/utils/filesystem");

type MockDirentKind = "directory" | "file" | "symlink";

const createDirent = (name: string, kind: MockDirentKind) => ({
  name,
  isDirectory: () => kind === "directory",
  isFile: () => kind === "file",
  isSymbolicLink: () => kind === "symlink",
});

const createNodeError = (code: string): NodeJS.ErrnoException => {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
};

const importFileUtilsWithReaddir = async (
  modulePath: string,
  readdir: (dirPath: string) => Promise<unknown[]>,
): Promise<FileUtilsModule> => {
  vi.resetModules();
  vi.doMock("node:fs/promises", async () => {
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    return {
      ...actual,
      realpath: vi.fn(async (dirPath: string) => dirPath),
      readdir: vi.fn(readdir),
    };
  });

  return (await import(modulePath)) as FileUtilsModule;
};

describe("recursive file walking", () => {
  afterEach(() => {
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it.each([
    ["runtime", "@mdcz/runtime/scrape/utils/filesystem"],
    ["desktop", "@main/utils/file"],
  ])("skips missing nested directories in %s scans", async (_label, modulePath) => {
    const root = join("library");
    const missingAssetDir = join(root, "extrafanart");
    const videoPath = join(root, "ABC-123.mp4");
    const fileUtils = await importFileUtilsWithReaddir(modulePath, async (dirPath) => {
      if (dirPath === root) {
        return [createDirent("ABC-123.mp4", "file"), createDirent("extrafanart", "directory")];
      }

      if (dirPath === missingAssetDir) {
        throw createNodeError("ENOENT");
      }

      return [];
    });

    await expect(fileUtils.listVideoFiles(root, true)).resolves.toEqual([videoPath]);
  });

  it("still rejects when the scan root cannot be read", async () => {
    const root = join("missing-root");
    const fileUtils = await importFileUtilsWithReaddir("@mdcz/runtime/scrape/utils/filesystem", async () => {
      throw createNodeError("ENOENT");
    });

    await expect(fileUtils.listVideoFiles(root, true)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

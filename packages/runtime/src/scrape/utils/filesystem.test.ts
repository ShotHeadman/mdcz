import type * as NodeFsPromises from "node:fs/promises";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { createTempDirectory, type TempDirectoryHarness } from "../../../../../tests/harness/tempDirectory";

const filesystemFaults = vi.hoisted(() => ({
  renameErrors: [] as NodeJS.ErrnoException[],
  unlinkError: null as NodeJS.ErrnoException | null,
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof NodeFsPromises>("node:fs/promises");
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      const error = filesystemFaults.renameErrors.shift();
      if (error) throw error;
      return await actual.rename(...args);
    },
    unlink: async (...args: Parameters<typeof actual.unlink>) => {
      if (filesystemFaults.unlinkError) {
        const error = filesystemFaults.unlinkError;
        filesystemFaults.unlinkError = null;
        throw error;
      }
      return await actual.unlink(...args);
    },
  };
});

import { listVideoFiles, moveFileSafely } from "./filesystem";

const tempDirectories: TempDirectoryHarness[] = [];

const createError = (message: string, code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(message), { code });

const createRoot = async (): Promise<string> => {
  const directory = await createTempDirectory("move-file-safely");
  tempDirectories.push(directory);
  return directory.path;
};

afterEach(async () => {
  filesystemFaults.renameErrors.length = 0;
  filesystemFaults.unlinkError = null;
  await Promise.all(tempDirectories.splice(0).map((directory) => directory.cleanup()));
});

describe("moveFileSafely", () => {
  it("preserves both complete copies when cross-device source removal fails", async () => {
    const root = await createRoot();
    const sourcePath = join(root, "source", "movie.mp4");
    const targetPath = join(root, "target", "movie.mp4");
    await mkdir(join(root, "source"), { recursive: true });
    await writeFile(sourcePath, "complete-video");
    filesystemFaults.renameErrors.push(createError("cross-device", "EXDEV"));
    filesystemFaults.unlinkError = createError("source busy", "EBUSY");

    await expect(moveFileSafely(sourcePath, targetPath)).rejects.toThrow("both complete copies were preserved");

    await expect(readFile(sourcePath, "utf8")).resolves.toBe("complete-video");
    await expect(readFile(targetPath, "utf8")).resolves.toBe("complete-video");
    await expect(readdir(join(root, "target"))).resolves.toEqual(["movie.mp4"]);
  });

  it("removes only its temporary part when cross-device publication fails", async () => {
    const root = await createRoot();
    const sourcePath = join(root, "source", "movie.mp4");
    const targetDirectory = join(root, "target");
    const targetPath = join(targetDirectory, "movie.mp4");
    await mkdir(join(root, "source"), { recursive: true });
    await writeFile(sourcePath, "complete-video");
    const publishError = createError("publish failed", "EIO");
    filesystemFaults.renameErrors.push(createError("cross-device", "EXDEV"), publishError);

    await expect(moveFileSafely(sourcePath, targetPath)).rejects.toBe(publishError);

    await expect(readFile(sourcePath, "utf8")).resolves.toBe("complete-video");
    await expect(readdir(targetDirectory)).resolves.toEqual([]);
  });

  it("does not include hidden crash-leftover part files in media scans", async () => {
    const root = await createRoot();
    await writeFile(join(root, "movie.mp4"), "video");
    await writeFile(join(root, ".movie.mp4.12345678.part"), "copied-video");

    await expect(listVideoFiles(root)).resolves.toEqual([join(root, "movie.mp4")]);
  });
});

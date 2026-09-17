import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { createTempDirectory, type TempDirectoryHarness } from "../../../../../tests/harness/tempDirectory";

import { listVideoFiles } from "./filesystem";

const tempDirectories: TempDirectoryHarness[] = [];

const createRoot = async (): Promise<string> => {
  const directory = await createTempDirectory("list-video-files");
  tempDirectories.push(directory);
  return directory.path;
};

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => directory.cleanup()));
});

describe("listVideoFiles", () => {
  it("does not include hidden crash-leftover part files in media scans", async () => {
    const root = await createRoot();
    await writeFile(join(root, "movie.mp4"), "video");
    await writeFile(join(root, ".movie.mp4.12345678.part"), "copied-video");

    await expect(listVideoFiles(root)).resolves.toEqual([join(root, "movie.mp4")]);
  });
});

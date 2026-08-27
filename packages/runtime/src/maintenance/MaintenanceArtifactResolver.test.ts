import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { LocalScanEntry } from "@mdcz/shared/types";
import { afterEach, describe, expect, it } from "vitest";
import { createTempDirectory, type TempDirectoryHarness } from "../../../../tests/harness/tempDirectory";
import type { OrganizePlan } from "../scrape";
import { MaintenanceArtifactResolver } from "./MaintenanceArtifactResolver";

const tempDirectories: TempDirectoryHarness[] = [];

const createRoot = async (): Promise<string> => {
  const directory = await createTempDirectory("maintenance-artifacts");
  tempDirectories.push(directory);
  return directory.path;
};

const createEntry = (root: string, assets: Partial<LocalScanEntry["assets"]> = {}): LocalScanEntry => ({
  fileId: "file-1",
  fileInfo: {
    filePath: join(root, "source", "movie.mp4"),
    fileName: "movie",
    extension: ".mp4",
    number: "ABC-123",
    isSubtitled: false,
  },
  assets: {
    sceneImages: [],
    actorPhotos: [],
    ...assets,
  },
  currentDir: join(root, "source"),
});

const createPlan = (root: string): OrganizePlan => ({
  outputDir: join(root, "output"),
  targetVideoPath: join(root, "output", "movie.mp4"),
  nfoPath: join(root, "output", "movie.nfo"),
});

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => directory.cleanup()));
});

describe("MaintenanceArtifactResolver", () => {
  it("moves a source-only asset to the exact planned target", async () => {
    const root = await createRoot();
    const sourcePath = join(root, "source", "thumb.jpg");
    const targetPath = join(root, "output", "thumb.jpg");
    await mkdir(join(root, "source"), { recursive: true });
    await writeFile(sourcePath, "thumb");

    const result = await new MaintenanceArtifactResolver().resolve({
      entry: createEntry(root, { thumb: sourcePath }),
      plan: createPlan(root),
      outputVideoPath: join(root, "output", "movie.mp4"),
    });

    expect(result.assets.thumb).toBe(targetPath);
    expect(result.publicationArtifacts).toEqual([{ targetPath, data: Buffer.from("thumb") }]);
    await expect(readFile(sourcePath, "utf8")).resolves.toBe("thumb");
    await expect(access(targetPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an unreferenced target-only state without changing the target", async () => {
    const root = await createRoot();
    const sourcePath = join(root, "source", "thumb.jpg");
    const targetPath = join(root, "output", "thumb.jpg");
    await mkdir(join(root, "output"), { recursive: true });
    await writeFile(targetPath, "existing-target");

    await expect(
      new MaintenanceArtifactResolver().resolve({
        entry: createEntry(root, { thumb: sourcePath }),
        plan: createPlan(root),
        outputVideoPath: join(root, "output", "movie.mp4"),
      }),
    ).rejects.toThrow("Ambiguous maintenance asset state");

    await expect(readFile(targetPath, "utf8")).resolves.toBe("existing-target");
  });

  it("accepts a target-only state when the current scan explicitly references that target", async () => {
    const root = await createRoot();
    const sourcePath = join(root, "source", "thumb.jpg");
    const targetPath = join(root, "output", "thumb.jpg");
    await mkdir(join(root, "output"), { recursive: true });
    await writeFile(targetPath, "existing-target");

    const result = await new MaintenanceArtifactResolver().resolve({
      entry: createEntry(root, { thumb: sourcePath, poster: targetPath }),
      plan: createPlan(root),
      outputVideoPath: join(root, "output", "movie.mp4"),
    });

    expect(result.assets.thumb).toBe(targetPath);
    expect(result.assets.poster).toBe(targetPath);
    await expect(readFile(targetPath, "utf8")).resolves.toBe("existing-target");
  });

  it("keeps both same-size files when their SHA-256 digests conflict", async () => {
    const root = await createRoot();
    const sourcePath = join(root, "source", "thumb.jpg");
    const targetPath = join(root, "output", "thumb.jpg");
    await mkdir(join(root, "source"), { recursive: true });
    await mkdir(join(root, "output"), { recursive: true });
    await writeFile(sourcePath, "source");
    await writeFile(targetPath, "target");

    await expect(
      new MaintenanceArtifactResolver().resolve({
        entry: createEntry(root, { thumb: sourcePath }),
        plan: createPlan(root),
        outputVideoPath: join(root, "output", "movie.mp4"),
      }),
    ).rejects.toThrow("SHA-256 digests differ");

    await expect(readFile(sourcePath, "utf8")).resolves.toBe("source");
    await expect(readFile(targetPath, "utf8")).resolves.toBe("target");
  });

  it("defers identical-source cleanup until every replacement succeeds", async () => {
    const root = await createRoot();
    const sourceThumbPath = join(root, "source", "thumb.jpg");
    const targetThumbPath = join(root, "output", "thumb.jpg");
    const sourcePosterPath = join(root, "source", "poster.jpg");
    const targetPosterPath = join(root, "output", "poster.jpg");
    await mkdir(join(root, "source"), { recursive: true });
    await mkdir(join(root, "output"), { recursive: true });
    await writeFile(sourceThumbPath, "identical-thumb");
    await writeFile(targetThumbPath, "identical-thumb");
    await writeFile(sourcePosterPath, "source");
    await writeFile(targetPosterPath, "target");

    await expect(
      new MaintenanceArtifactResolver().resolve({
        entry: createEntry(root, { thumb: sourceThumbPath, poster: sourcePosterPath }),
        plan: createPlan(root),
        outputVideoPath: join(root, "output", "movie.mp4"),
      }),
    ).rejects.toThrow("SHA-256 digests differ");

    await expect(readFile(sourceThumbPath, "utf8")).resolves.toBe("identical-thumb");
    await expect(readFile(targetThumbPath, "utf8")).resolves.toBe("identical-thumb");
  });

  it("removes an identical source duplicate after the full resolution succeeds", async () => {
    const root = await createRoot();
    const sourcePath = join(root, "source", "thumb.jpg");
    const targetPath = join(root, "output", "thumb.jpg");
    await mkdir(join(root, "source"), { recursive: true });
    await mkdir(join(root, "output"), { recursive: true });
    await writeFile(sourcePath, "identical-thumb");
    await writeFile(targetPath, "identical-thumb");

    const result = await new MaintenanceArtifactResolver().resolve({
      entry: createEntry(root, { thumb: sourcePath }),
      plan: createPlan(root),
      outputVideoPath: join(root, "output", "movie.mp4"),
    });

    expect(result.assets.thumb).toBe(targetPath);
    expect(result.obsoletePaths).toContain(sourcePath);
    await expect(access(sourcePath)).resolves.toBeUndefined();
    await expect(readFile(targetPath, "utf8")).resolves.toBe("identical-thumb");
  });
});

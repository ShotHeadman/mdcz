import { defaultConfiguration } from "@mdcz/shared/config";
import { buildFileId } from "@mdcz/shared/mediaIdentity";
import type { CrawlerData, LocalScanEntry } from "@mdcz/shared/types";
import { describe, expect, it, vi } from "vitest";
import { confirmUncensoredOutputs, type UncensoredConfirmDependencies } from "./confirmUncensored";

const crawlerData: CrawlerData = {
  title: "Multipart",
  number: "ABC-123",
  actors: [],
  genres: ["无码"],
  scene_images: [],
};

const entryFor = (videoPath: string, nfoPath = "/media/movie.nfo"): LocalScanEntry => ({
  fileId: buildFileId(videoPath),
  fileInfo: {
    filePath: videoPath,
    fileName:
      videoPath
        .split("/")
        .at(-1)
        ?.replace(/\.mp4$/u, "") ?? "video",
    extension: ".mp4",
    number: "ABC-123",
    isSubtitled: false,
    part: { number: videoPath.includes("CD2") ? 2 : 1, suffix: videoPath.includes("CD2") ? "-CD2" : "-CD1" },
  },
  nfoPath,
  crawlerData,
  assets: { sceneImages: [], actorPhotos: [] },
  currentDir: "/media",
});

const dependencies = (): UncensoredConfirmDependencies => ({
  artifactResolver: {
    resolve: vi.fn(async ({ entry, outputVideoPath, savedNfoPath }) => ({
      nfoPath: savedNfoPath,
      assets: entry.assets,
      outputVideoPath,
    })),
  },
  fileOrganizer: {
    plan: vi.fn((fileInfo) => ({
      outputDir: "/media/leak",
      targetVideoPath: `/media/leak/${fileInfo.fileName}.mp4`,
      nfoPath: "/media/leak/movie.nfo",
    })),
    ensureOutputReady: vi.fn(async (plan) => plan),
    organizeVideo: vi.fn(async (_fileInfo, plan) => plan.targetVideoPath),
  },
  localScanService: { scanVideo: vi.fn(async (videoPath) => entryFor(videoPath)) },
  logger: { info: vi.fn(), warn: vi.fn() },
  nfoGenerator: { writeNfo: vi.fn(async () => "/media/leak/movie.nfo") },
  pathExists: vi.fn(async () => true),
});

describe("confirmUncensoredOutputs", () => {
  it("groups multipart items sharing an NFO and writes that NFO once", async () => {
    const deps = dependencies();
    const items = ["/media/ABC-123-CD1.mp4", "/media/ABC-123-CD2.mp4"].map((videoPath) => ({
      fileId: buildFileId(videoPath),
      videoPath,
      nfoPath: "/media/movie.nfo",
      crawlerData,
      choice: "leak" as const,
    }));

    const result = await confirmUncensoredOutputs(items, defaultConfiguration, deps);

    expect(result.updatedCount).toBe(2);
    expect(result.failures).toEqual([]);
    expect(deps.fileOrganizer.organizeVideo).toHaveBeenCalledTimes(2);
    expect(deps.nfoGenerator.writeNfo).toHaveBeenCalledTimes(1);
    expect(deps.nfoGenerator.writeNfo).toHaveBeenCalledWith(
      "/media/leak/movie.nfo",
      crawlerData,
      expect.objectContaining({ localState: { uncensoredChoice: "leak" } }),
    );
  });

  it("reports a missing output per item without rejecting the batch", async () => {
    const deps = dependencies();
    deps.pathExists = vi.fn(async () => false);

    const result = await confirmUncensoredOutputs(
      [{ fileId: "missing", videoPath: "/media/missing.mp4", nfoPath: "/media/missing.nfo", choice: "umr" }],
      defaultConfiguration,
      deps,
    );

    expect(result.updatedCount).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.failures).toEqual([
      expect.objectContaining({ fileId: "missing", message: expect.stringContaining("output files not found") }),
    ]);
    expect(deps.localScanService.scanVideo).not.toHaveBeenCalled();
  });

  it("rejects conflicting choices for multipart items sharing one NFO before moving files", async () => {
    const deps = dependencies();
    const result = await confirmUncensoredOutputs(
      [
        {
          fileId: "part-1",
          videoPath: "/media/ABC-123-CD1.mp4",
          nfoPath: "/media/movie.nfo",
          crawlerData,
          choice: "leak",
        },
        {
          fileId: "part-2",
          videoPath: "/media/ABC-123-CD2.mp4",
          nfoPath: "/media/movie.nfo",
          crawlerData,
          choice: "umr",
        },
      ],
      defaultConfiguration,
      deps,
    );

    expect(result.updatedCount).toBe(0);
    expect(result.failures).toHaveLength(2);
    expect(result.failures.every((failure) => failure.message.includes("Conflicting uncensored choices"))).toBe(true);
    expect(deps.fileOrganizer.organizeVideo).not.toHaveBeenCalled();
    expect(deps.nfoGenerator.writeNfo).not.toHaveBeenCalled();
  });

  it("applies mixed choices to independent NFO groups", async () => {
    const deps = dependencies();
    deps.localScanService.scanVideo = vi.fn(async (videoPath) =>
      entryFor(videoPath, videoPath.replace(/\.mp4$/u, ".nfo")),
    );
    const result = await confirmUncensoredOutputs(
      [
        {
          fileId: "leak",
          videoPath: "/media/LEAK-001.mp4",
          nfoPath: "/media/LEAK-001.nfo",
          crawlerData,
          choice: "leak",
        },
        {
          fileId: "umr",
          videoPath: "/media/UMR-001.mp4",
          nfoPath: "/media/UMR-001.nfo",
          crawlerData,
          choice: "umr",
        },
      ],
      defaultConfiguration,
      deps,
    );

    expect(result.updatedCount).toBe(2);
    expect(result.items.map((item) => item.choice).sort()).toEqual(["leak", "umr"]);
    expect(result.failures).toEqual([]);
    expect(deps.nfoGenerator.writeNfo).toHaveBeenCalledTimes(2);
  });
});

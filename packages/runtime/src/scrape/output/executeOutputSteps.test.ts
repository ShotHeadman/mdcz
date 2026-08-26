import { configurationSchema, defaultConfiguration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData, DownloadedAssets, FileInfo } from "@mdcz/shared/types";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeActorImageService } from "../actorOutput";
import type { DownloadCallbacks, DownloadManager } from "../download";
import type { FileOrganizer, OrganizePlan } from "../FileOrganizer";
import type { NfoGenerator, NfoOptions } from "../nfo";
import {
  downloadCrawlerAssets,
  organizePreparedVideo,
  prepareOutputCrawlerData,
  updateBatchProgress,
  writePreparedNfo,
} from "./executeOutputSteps";

const config = configurationSchema.parse(defaultConfiguration);

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Sample",
  number: "ABC-123",
  actors: [],
  genres: [],
  scene_images: [],
  website: Website.DMM,
  ...overrides,
});

const createFileInfo = (): FileInfo => ({
  filePath: "/library/ABC-123.mp4",
  fileName: "ABC-123.mp4",
  extension: ".mp4",
  number: "ABC-123",
  isSubtitled: false,
});

describe("shared output steps", () => {
  it("normalizes per-file progress into batch progress", () => {
    const setProgress = vi.fn();

    updateBatchProgress({ setProgress }, { fileIndex: 2, totalFiles: 4 }, 50);
    updateBatchProgress({ setProgress }, { fileIndex: 0, totalFiles: 0 }, 150);

    expect(setProgress).toHaveBeenNthCalledWith(1, 38, 2, 4);
    expect(setProgress).toHaveBeenNthCalledWith(2, 100, 1, 1);
  });

  it("preserves absent or disabled crawler data without actor output work", async () => {
    const actorImageService = {
      prepareActorProfilesForMovie: vi.fn(),
    } as unknown as RuntimeActorImageService;
    const crawlerData = createCrawlerData();

    await expect(
      prepareOutputCrawlerData({
        actorImageService,
        config,
        enabled: true,
        sourceVideoPath: "/library/missing.mp4",
      }),
    ).resolves.toEqual({ data: undefined, actorPhotoPaths: [] });
    await expect(
      prepareOutputCrawlerData({
        actorImageService,
        config,
        crawlerData,
        enabled: false,
        movieDir: "/library/ABC-123",
        sourceVideoPath: "/library/ABC-123.mp4",
      }),
    ).resolves.toEqual({ data: crawlerData, actorPhotoPaths: [] });
    expect(actorImageService.prepareActorProfilesForMovie).not.toHaveBeenCalled();
  });

  it("publishes resolved scene metadata before host asset post-processing", async () => {
    const crawlerData = createCrawlerData({ scene_images: ["https://old.example/scene.jpg"] });
    const downloadedAssets: DownloadedAssets = {
      downloaded: ["/output/scene-1.jpg"],
      sceneImages: ["/output/scene-1.jpg"],
    };
    const callerSceneProgress = vi.fn();
    const callerResolvedScenes = vi.fn();
    const postProcessAssets = vi.fn(async (assets: DownloadedAssets, resolvedData: CrawlerData) => ({
      ...assets,
      poster: `/output/${resolvedData.scene_images.length}-poster.jpg`,
    }));
    const downloadAll = vi.fn(
      async (
        _outputDir: string,
        _data: CrawlerData,
        _config: typeof config,
        _alternatives: unknown,
        callbacks?: DownloadCallbacks,
      ) => {
        callbacks?.onSceneProgress?.(1, 2);
        callbacks?.onResolvedSceneImageUrls?.(["https://new.example/scene-1.jpg", "https://new.example/scene-2.jpg"]);
        return downloadedAssets;
      },
    );
    const logs: string[] = [];

    const result = await downloadCrawlerAssets({
      callbacks: {
        onResolvedSceneImageUrls: callerResolvedScenes,
        onSceneProgress: callerSceneProgress,
      },
      config,
      crawlerData,
      downloadManager: { downloadAll } as unknown as DownloadManager,
      fileInfo: createFileInfo(),
      outputDir: "/output",
      onLog: (message) => logs.push(message),
      postProcessAssets,
    });

    expect(result.crawlerData.scene_images).toEqual([
      "https://new.example/scene-1.jpg",
      "https://new.example/scene-2.jpg",
    ]);
    expect(result.assets.poster).toBe("/output/2-poster.jpg");
    expect(postProcessAssets).toHaveBeenCalledWith(downloadedAssets, result.crawlerData);
    expect(callerSceneProgress).toHaveBeenCalledWith(1, 2);
    expect(callerResolvedScenes).toHaveBeenCalledWith([
      "https://new.example/scene-1.jpg",
      "https://new.example/scene-2.jpg",
    ]);
    expect(logs).toEqual(["[ABC-123] Downloading resources...", "[ABC-123] Scene images: 1/2"]);
  });

  it("writes prepared NFO with injected probe and tag builder", async () => {
    const crawlerData = createCrawlerData();
    const fileInfo = createFileInfo();
    const assets: DownloadedAssets = { downloaded: [], sceneImages: [] };
    const probeVideoMetadata = vi.fn().mockResolvedValue({ durationSeconds: 120 });
    const buildTags: NonNullable<NfoOptions["buildTags"]> = () => ["tag"];
    const writeNfo = vi.fn().mockResolvedValue("/output/ABC-123.nfo");
    const logs: string[] = [];

    const result = await writePreparedNfo({
      assets,
      buildTags,
      config,
      crawlerData,
      enabled: true,
      fileInfo,
      nfoGenerator: { writeNfo } as unknown as NfoGenerator,
      nfoPath: "/output/ABC-123.nfo",
      onLog: (message) => logs.push(message),
      probeVideoMetadata,
      sourceVideoPath: fileInfo.filePath,
      startLogLabel: "Generating NFO",
    });

    expect(result).toBe("/output/ABC-123.nfo");
    expect(probeVideoMetadata).toHaveBeenCalledWith(fileInfo.filePath);
    expect(writeNfo).toHaveBeenCalledWith(
      "/output/ABC-123.nfo",
      crawlerData,
      expect.objectContaining({
        assets,
        buildTags,
        fileInfo,
        videoMeta: { durationSeconds: 120 },
      }),
    );
    expect(logs).toEqual(["Generating NFO"]);
  });

  it("organizes only when the output step and plan are both enabled", async () => {
    const fileInfo = createFileInfo();
    const plan: OrganizePlan = {
      nfoPath: "/output/ABC-123.nfo",
      outputDir: "/output",
      targetVideoPath: "/output/ABC-123.mp4",
    };
    const organizeVideo = vi.fn().mockResolvedValue(plan.targetVideoPath);
    const fileOrganizer = { organizeVideo } as unknown as FileOrganizer;

    await expect(organizePreparedVideo({ config, enabled: false, fileInfo, fileOrganizer, plan })).resolves.toBe(
      fileInfo.filePath,
    );
    await expect(organizePreparedVideo({ config, enabled: true, fileInfo, fileOrganizer })).resolves.toBe(
      fileInfo.filePath,
    );
    await expect(organizePreparedVideo({ config, enabled: true, fileInfo, fileOrganizer, plan })).resolves.toBe(
      plan.targetVideoPath,
    );
    expect(organizeVideo).toHaveBeenCalledOnce();
  });
});

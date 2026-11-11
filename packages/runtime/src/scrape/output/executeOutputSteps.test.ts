import { configurationSchema, defaultConfiguration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData, DownloadedAssets, FileInfo } from "@mdcz/shared/types";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeActorImageService } from "../actorOutput";
import type { DownloadCallbacks, DownloadManager } from "../download";
import type { NfoGenerator, NfoOptions } from "../nfo";
import {
  downloadCrawlerAssets,
  prepareOutputCrawlerData,
  reportItemProgress,
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
  it("reports precise item progress regardless of batch size", () => {
    const setProgress = vi.fn();

    reportItemProgress({ setProgress }, { fileIndex: 2, totalFiles: 150 }, 37.5);
    reportItemProgress({ setProgress }, { fileIndex: 0, totalFiles: 0 }, 150);

    expect(setProgress).toHaveBeenNthCalledWith(1, 37.5, 2, 150);
    expect(setProgress).toHaveBeenNthCalledWith(2, 100, 1, 1);
  });

  it("skips actor output work for absent crawler data or with actor photo downloads off", async () => {
    const actorImageService = {
      prepareActorProfilesForMovie: vi.fn(),
    } as unknown as RuntimeActorImageService;
    const crawlerData = createCrawlerData({ actors: ["Actor A"], thumb_url: "https://example.com/thumb.jpg" });

    await expect(
      prepareOutputCrawlerData({
        actorImageService,
        config,
        sourceVideoPath: "/library/missing.mp4",
      }),
    ).resolves.toEqual({ data: undefined, actorPhotoPaths: [] });
    await expect(
      prepareOutputCrawlerData({
        actorImageService,
        config: configurationSchema.parse({ ...defaultConfiguration, personSync: { downloadActorPhotos: false } }),
        crawlerData,
        movieDir: "/library/ABC-123",
        sourceVideoPath: "/library/ABC-123.mp4",
      }),
    ).resolves.toEqual({
      data: { ...crawlerData, thumb_source_url: crawlerData.thumb_url, fanart_source_url: crawlerData.thumb_url },
      actorPhotoPaths: [],
    });
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
        _naming: unknown,
        _alternatives: unknown,
        callbacks?: DownloadCallbacks,
      ) => {
        callbacks?.onSceneProgress?.(1, 2);
        callbacks?.onResolvedSceneImageUrls?.(["https://new.example/scene-1.jpg", "https://new.example/scene-2.jpg"]);
        return downloadedAssets;
      },
    );
    const result = await downloadCrawlerAssets({
      callbacks: {
        onResolvedSceneImageUrls: callerResolvedScenes,
        onSceneProgress: callerSceneProgress,
      },
      config,
      naming: { sharedFolder: false, assetNaming: "fixed", nfoNaming: "both", sceneImages: true },
      crawlerData,
      downloadManager: { downloadAll } as unknown as DownloadManager,
      fileInfo: createFileInfo(),
      outputDir: "/output",
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
  });

  it("writes prepared NFO with injected probe and tag builder", async () => {
    const crawlerData = createCrawlerData();
    const fileInfo = createFileInfo();
    const assets: DownloadedAssets = { downloaded: [], sceneImages: [] };
    const probeVideoMetadata = vi.fn().mockResolvedValue({ durationSeconds: 120 });
    const buildTags: NonNullable<NfoOptions["buildTags"]> = () => ["tag"];
    const writeNfo = vi.fn().mockResolvedValue("/output/ABC-123.nfo");
    const result = await writePreparedNfo({
      assets,
      buildTags,
      config,
      naming: { nfoNaming: "filename", sceneImages: false },
      crawlerData,
      enabled: true,
      fileInfo,
      nfoGenerator: { writeNfo } as unknown as NfoGenerator,
      nfoPath: "/output/ABC-123.nfo",
      probeVideoMetadata,
      sourceVideoPath: fileInfo.filePath,
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
        nfoNaming: "filename",
        includeRemoteSceneImageUrls: false,
        videoMeta: { durationSeconds: 120 },
      }),
    );
  });
});

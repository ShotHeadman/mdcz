import type { Configuration } from "@main/services/config";
import { confirmUncensoredItems } from "@main/services/scraper/confirmUncensored";
import { Website } from "@shared/enums";
import type { CrawlerData, DiscoveredAssets, LocalScanEntry } from "@shared/types";
import { describe, expect, it, vi } from "vitest";

const createConfig = (): Configuration =>
  ({
    download: {
      generateNfo: true,
    },
    paths: {
      sceneImagesFolder: "extrafanart",
    },
  }) as Configuration;

const createCrawlerData = (number = "FC2-123456"): CrawlerData => ({
  title: number,
  number,
  actors: [],
  genres: [],
  scene_images: [],
  website: Website.FC2,
});

const createAssets = (): DiscoveredAssets => ({
  sceneImages: [],
  actorPhotos: [],
});

const createEntry = (overrides: Partial<LocalScanEntry>): LocalScanEntry => ({
  id: overrides.id ?? "entry-1",
  videoPath: overrides.videoPath ?? "/library/FC2-123456-cd1.mp4",
  fileInfo: overrides.fileInfo ?? {
    filePath: overrides.videoPath ?? "/library/FC2-123456-cd1.mp4",
    fileName: "FC2-123456-cd1",
    extension: ".mp4",
    number: "FC2-123456",
    isSubtitled: false,
    part: {
      number: 1,
      suffix: "-cd1",
    },
  },
  nfoPath: overrides.nfoPath ?? "/library/FC2-123456.nfo",
  crawlerData: overrides.crawlerData ?? createCrawlerData(),
  nfoLocalState: overrides.nfoLocalState,
  scanError: overrides.scanError,
  assets: overrides.assets ?? createAssets(),
  currentDir: overrides.currentDir ?? "/library",
});

describe("confirmUncensoredItems", () => {
  it("writes one shared NFO for multipart files that share the same source NFO", async () => {
    const firstEntry = createEntry({
      id: "part-1",
      videoPath: "/library/FC2-123456-cd1.mp4",
      fileInfo: {
        filePath: "/library/FC2-123456-cd1.mp4",
        fileName: "FC2-123456-cd1",
        extension: ".mp4",
        number: "FC2-123456",
        isSubtitled: false,
        part: {
          number: 1,
          suffix: "-cd1",
        },
      },
    });
    const secondEntry = createEntry({
      id: "part-2",
      videoPath: "/library/FC2-123456-cd2.mp4",
      fileInfo: {
        filePath: "/library/FC2-123456-cd2.mp4",
        fileName: "FC2-123456-cd2",
        extension: ".mp4",
        number: "FC2-123456",
        isSubtitled: true,
        subtitleTag: "中文字幕",
        part: {
          number: 2,
          suffix: "-cd2",
        },
      },
    });

    const writeNfo = vi.fn().mockResolvedValue("/output/FC2-123456/FC2-123456.nfo");
    const resolve = vi.fn().mockImplementation(async ({ outputVideoPath, savedNfoPath }) => ({
      nfoPath: savedNfoPath,
      assets: {
        thumb: undefined,
        poster: undefined,
        fanart: undefined,
        sceneImages: [],
        trailer: undefined,
        nfo: savedNfoPath,
        actorPhotos: [],
      },
      outputVideoPath,
    }));

    const result = await confirmUncensoredItems(
      [
        {
          nfoPath: "/library/FC2-123456.nfo",
          videoPath: "/library/FC2-123456-cd1.mp4",
          choice: "uncensored",
        },
        {
          nfoPath: "/library/FC2-123456.nfo",
          videoPath: "/library/FC2-123456-cd2.mp4",
          choice: "uncensored",
        },
      ],
      createConfig(),
      {
        artifactResolver: {
          resolve,
        },
        fileOrganizer: {
          plan: vi.fn().mockImplementation((fileInfo) => ({
            outputDir: "/output/FC2-123456",
            targetVideoPath: fileInfo.filePath.replace("/library", "/output/FC2-123456"),
            nfoPath: "/output/FC2-123456/FC2-123456.nfo",
          })),
          ensureOutputReady: vi.fn().mockImplementation(async (plan) => plan),
          organizeVideo: vi
            .fn()
            .mockResolvedValueOnce("/output/FC2-123456/FC2-123456-cd1.mp4")
            .mockResolvedValueOnce("/output/FC2-123456/FC2-123456-cd2.mp4"),
        },
        localScanService: {
          scanVideo: vi.fn().mockResolvedValueOnce(firstEntry).mockResolvedValueOnce(secondEntry),
        },
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
        },
        nfoGenerator: {
          writeNfo,
        },
        pathExists: vi.fn().mockResolvedValue(true),
      },
    );

    expect(writeNfo).toHaveBeenCalledTimes(1);
    expect(writeNfo).toHaveBeenCalledWith(
      "/output/FC2-123456/FC2-123456.nfo",
      firstEntry.crawlerData,
      expect.objectContaining({
        fileInfo: expect.objectContaining({
          filePath: "/output/FC2-123456/FC2-123456-cd1.mp4",
          isSubtitled: true,
          subtitleTag: "中文字幕",
          part: undefined,
        }),
        localState: expect.objectContaining({
          uncensoredChoice: "uncensored",
        }),
      }),
    );
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      updatedCount: 2,
      items: [
        {
          sourceVideoPath: "/library/FC2-123456-cd1.mp4",
          sourceNfoPath: "/library/FC2-123456.nfo",
          targetVideoPath: "/output/FC2-123456/FC2-123456-cd1.mp4",
          targetNfoPath: "/output/FC2-123456/FC2-123456.nfo",
          choice: "uncensored",
        },
        {
          sourceVideoPath: "/library/FC2-123456-cd2.mp4",
          sourceNfoPath: "/library/FC2-123456.nfo",
          targetVideoPath: "/output/FC2-123456/FC2-123456-cd2.mp4",
          targetNfoPath: "/output/FC2-123456/FC2-123456.nfo",
          choice: "uncensored",
        },
      ],
    });
  });
});

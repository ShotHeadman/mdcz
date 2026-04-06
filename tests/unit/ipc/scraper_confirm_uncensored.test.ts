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
    naming: {},
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
  fileId: overrides.fileId ?? "entry-1",
  fileInfo: overrides.fileInfo ?? {
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
      fileId: "part-1",
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
      fileId: "part-2",
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
        actorPhotos: [],
      },
      outputVideoPath,
    }));

    const result = await confirmUncensoredItems(
      [
        {
          fileId: "part-1",
          nfoPath: "/library/FC2-123456.nfo",
          videoPath: "/library/FC2-123456-cd1.mp4",
          choice: "uncensored",
        },
        {
          fileId: "part-2",
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
          fileId: "part-1",
          sourceVideoPath: "/library/FC2-123456-cd1.mp4",
          sourceNfoPath: "/library/FC2-123456.nfo",
          targetVideoPath: "/output/FC2-123456/FC2-123456-cd1.mp4",
          targetNfoPath: "/output/FC2-123456/FC2-123456.nfo",
          choice: "uncensored",
        },
        {
          fileId: "part-2",
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

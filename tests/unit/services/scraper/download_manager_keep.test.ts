import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { PersistentCooldownStore } from "@main/services/cooldown/PersistentCooldownStore";
import type { NetworkClient, ProbeResult } from "@main/services/network";
import { DownloadManager } from "@main/services/scraper/DownloadManager";
import * as imageUtils from "@main/utils/image";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-download-manager-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const createConfig = (overrides: Record<string, unknown> = {}) =>
  configurationSchema.parse({
    ...defaultConfiguration,
    ...overrides,
  });

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Sample",
  number: "ABC-123",
  actors: [],
  genres: [],
  sample_images: [],
  website: Website.DMM,
  ...overrides,
});

const createDownloadConfig = (overrides: Partial<typeof defaultConfiguration.download> = {}) =>
  createConfig({
    download: {
      ...defaultConfiguration.download,
      ...overrides,
    },
  });

const seedFiles = async (root: string, files: Record<string, string>): Promise<void> => {
  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const filePath = join(root, relativePath);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, "utf8");
    }),
  );
};

const createDownloadSubject = async (
  files: Record<string, string> = {},
  options: {
    imageHostCooldownStore?: PersistentCooldownStore;
  } = {},
) => {
  const root = await createTempDir();
  await seedFiles(root, files);

  const networkClient = new FakeNetworkClient();
  const manager = new DownloadManager(networkClient as unknown as NetworkClient, options);

  return { root, networkClient, manager };
};

const mockImageValidation = (valid: boolean) =>
  vi.spyOn(imageUtils, "validateImage").mockResolvedValue(
    valid
      ? {
          valid: true,
          width: 1,
          height: 1,
        }
      : {
          valid: false,
          width: 0,
          height: 0,
          reason: "parse_failed",
        },
  );

class FakeNetworkClient {
  readonly download = vi.fn(async (url: string, outputPath: string) => {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `downloaded:${url}`, "utf8");
    return outputPath;
  });

  readonly probe = vi.fn(
    async (url: string): Promise<ProbeResult> => ({
      ok: true,
      status: 200,
      contentLength: 1024,
      resolvedUrl: url,
    }),
  );
}

describe("DownloadManager keep flags", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map(async (dirPath) => {
        await rm(dirPath, { recursive: true, force: true });
      }),
    );
  });

  it("reuses existing sidecar assets when keep flags are enabled", async () => {
    const { root, manager, networkClient } = await createDownloadSubject({
      "thumb.jpg": "thumb",
      "poster.jpg": "poster",
      "fanart.jpg": "fanart",
      "trailer.mp4": "trailer",
      "extrafanart/fanart1.jpg": "scene",
    });
    const assets = await manager.downloadAll(
      root,
      createCrawlerData({
        thumb_url: "https://example.com/thumb.jpg",
        poster_url: "https://example.com/poster.jpg",
        fanart_url: "https://example.com/fanart.jpg",
        trailer_url: "https://example.com/trailer.mp4",
        sample_images: ["https://example.com/scene-001.jpg"],
      }),
      createConfig(),
    );

    expect(assets.thumb).toBe(join(root, "thumb.jpg"));
    expect(assets.poster).toBe(join(root, "poster.jpg"));
    expect(assets.fanart).toBe(join(root, "fanart.jpg"));
    expect(assets.trailer).toBe(join(root, "trailer.mp4"));
    expect(assets.sceneImages).toEqual([join(root, "extrafanart", "fanart1.jpg")]);
    expect(assets.downloaded).toEqual([]);
    expect(networkClient.probe).not.toHaveBeenCalled();
    expect(networkClient.download).not.toHaveBeenCalled();
  });

  it("replaces an existing trailer when maintenance explicitly selects the new trailer URL", async () => {
    const { root, manager, networkClient } = await createDownloadSubject({
      "trailer.mp4": "old-trailer",
    });
    const assets = await manager.downloadAll(
      root,
      createCrawlerData({
        trailer_url: "https://example.com/trailer-new.mp4",
      }),
      createDownloadConfig({
        downloadThumb: false,
        downloadPoster: false,
        downloadFanart: false,
        downloadSceneImages: false,
        keepTrailer: true,
      }),
      {},
      {
        assetDecisions: {
          trailer: "replace",
        },
      },
    );

    expect(assets.trailer).toBe(join(root, "trailer.mp4"));
    expect(assets.downloaded).toEqual([join(root, "trailer.mp4")]);
    await expect(readFile(join(root, "trailer.mp4"), "utf8")).resolves.toBe(
      "downloaded:https://example.com/trailer-new.mp4",
    );
    expect(networkClient.download).toHaveBeenCalledTimes(1);
  });

  it("does not silently keep an old trailer when maintenance replacement has no new trailer source", async () => {
    const { root, manager, networkClient } = await createDownloadSubject({
      "trailer.mp4": "old-trailer",
    });
    const assets = await manager.downloadAll(
      root,
      createCrawlerData({
        trailer_url: undefined,
      }),
      createDownloadConfig({
        downloadThumb: false,
        downloadPoster: false,
        downloadFanart: false,
        downloadSceneImages: false,
        keepTrailer: true,
      }),
      {},
      {
        assetDecisions: {
          trailer: "replace",
        },
      },
    );

    expect(assets.trailer).toBeUndefined();
    expect(assets.downloaded).toEqual([]);
    await expect(readFile(join(root, "trailer.mp4"), "utf8")).resolves.toBe("old-trailer");
    expect(networkClient.download).not.toHaveBeenCalled();
  });

  it("keeps the first sample image for scene images when an existing fanart is reused", async () => {
    const { root, manager, networkClient } = await createDownloadSubject({
      "fanart.jpg": "fanart",
    });
    mockImageValidation(true);
    const assets = await manager.downloadAll(
      root,
      createCrawlerData({
        sample_images: ["https://example.com/scene-001.jpg", "https://example.com/scene-002.jpg"],
      }),
      createDownloadConfig({
        downloadThumb: false,
        downloadPoster: false,
        downloadTrailer: false,
      }),
    );

    expect(assets.fanart).toBe(join(root, "fanart.jpg"));
    expect(assets.sceneImages).toEqual([
      join(root, "extrafanart", "fanart1.jpg"),
      join(root, "extrafanart", "fanart2.jpg"),
    ]);
    await expect(readFile(join(root, "extrafanart", "fanart1.jpg"), "utf8")).resolves.toBe(
      "downloaded:https://example.com/scene-001.jpg",
    );
    await expect(readFile(join(root, "extrafanart", "fanart2.jpg"), "utf8")).resolves.toBe(
      "downloaded:https://example.com/scene-002.jpg",
    );
    expect(networkClient.download).toHaveBeenCalledTimes(2);
  });

  it("creates missing fanart from an existing kept thumb", async () => {
    const { root, manager, networkClient } = await createDownloadSubject({
      "thumb.jpg": "thumb",
    });
    const assets = await manager.downloadAll(
      root,
      createCrawlerData(),
      createDownloadConfig({
        downloadTrailer: false,
        downloadSceneImages: false,
      }),
    );

    expect(assets.thumb).toBe(join(root, "thumb.jpg"));
    expect(assets.poster).toBeUndefined();
    expect(assets.fanart).toBe(join(root, "fanart.jpg"));
    expect(assets.downloaded).toEqual([join(root, "fanart.jpg")]);
    await expect(readFile(join(root, "fanart.jpg"), "utf8")).resolves.toBe("thumb");
    expect(networkClient.probe).not.toHaveBeenCalled();
    expect(networkClient.download).not.toHaveBeenCalled();
  });

  it("does not download fanart when thumb is unavailable", async () => {
    const { root, manager, networkClient } = await createDownloadSubject();
    mockImageValidation(true);
    const assets = await manager.downloadAll(
      root,
      createCrawlerData({
        thumb_url: "https://example.com/thumb.jpg",
        sample_images: ["https://example.com/scene-001.jpg", "https://example.com/scene-002.jpg"],
      }),
      createDownloadConfig({
        downloadThumb: false,
        downloadTrailer: false,
      }),
      {
        thumb_url: ["https://example.com/thumb-alt.jpg"],
      },
    );

    expect(assets.thumb).toBeUndefined();
    expect(assets.fanart).toBeUndefined();
    expect(assets.sceneImages).toEqual([
      join(root, "extrafanart", "fanart1.jpg"),
      join(root, "extrafanart", "fanart2.jpg"),
    ]);
    await expect(readFile(join(root, "extrafanart", "fanart1.jpg"), "utf8")).resolves.toBe(
      "downloaded:https://example.com/scene-001.jpg",
    );
    await expect(readFile(join(root, "extrafanart", "fanart2.jpg"), "utf8")).resolves.toBe(
      "downloaded:https://example.com/scene-002.jpg",
    );
    await expect(access(join(root, "fanart.jpg"))).rejects.toThrow();
    expect(networkClient.probe).not.toHaveBeenCalled();
    expect(networkClient.download).not.toHaveBeenCalledWith("https://example.com/thumb-alt.jpg", expect.any(String));
  });

  it("skips unsupported sample image urls for scene downloads and does not treat them as fanart", async () => {
    const { root, manager, networkClient } = await createDownloadSubject();
    mockImageValidation(true);
    const assets = await manager.downloadAll(
      root,
      createCrawlerData({
        sample_images: ["javascript:void(0)", "https://example.com/scene-001.jpg", "https://example.com/scene-002.jpg"],
      }),
      createDownloadConfig({
        downloadThumb: false,
        downloadPoster: false,
        downloadTrailer: false,
      }),
    );

    expect(assets.fanart).toBeUndefined();
    expect(assets.sceneImages).toEqual([
      join(root, "extrafanart", "fanart1.jpg"),
      join(root, "extrafanart", "fanart2.jpg"),
    ]);
    await expect(readFile(join(root, "extrafanart", "fanart1.jpg"), "utf8")).resolves.toBe(
      "downloaded:https://example.com/scene-001.jpg",
    );
    await expect(readFile(join(root, "extrafanart", "fanart2.jpg"), "utf8")).resolves.toBe(
      "downloaded:https://example.com/scene-002.jpg",
    );
    await expect(access(join(root, "fanart.jpg"))).rejects.toThrow();
    expect(networkClient.download).not.toHaveBeenCalledWith("javascript:void(0)", expect.any(String));
  });

  it("does not derive a missing thumb from an existing fanart image", async () => {
    const { root, manager, networkClient } = await createDownloadSubject({
      "fanart.jpg": "fanart",
    });
    const assets = await manager.downloadAll(
      root,
      createCrawlerData(),
      createDownloadConfig({
        downloadPoster: false,
        downloadSceneImages: false,
        downloadTrailer: false,
      }),
    );

    expect(assets.fanart).toBe(join(root, "fanart.jpg"));
    expect(assets.thumb).toBeUndefined();
    await expect(access(join(root, "thumb.jpg"))).rejects.toThrow();
    expect(networkClient.probe).not.toHaveBeenCalled();
    expect(networkClient.download).not.toHaveBeenCalled();
  });

  it("refreshes existing assets when keep flags are disabled", async () => {
    const { root, manager, networkClient } = await createDownloadSubject({
      "thumb.jpg": "old-thumb",
    });
    mockImageValidation(true);
    const assets = await manager.downloadAll(
      root,
      createCrawlerData({
        thumb_url: "https://example.com/thumb-new.jpg",
      }),
      createDownloadConfig({
        keepThumb: false,
        downloadPoster: false,
        downloadFanart: false,
        downloadSceneImages: false,
        downloadTrailer: false,
      }),
    );

    expect(assets.thumb).toBe(join(root, "thumb.jpg"));
    expect(assets.downloaded).toEqual([join(root, "thumb.jpg")]);
    await expect(readFile(join(root, "thumb.jpg"), "utf8")).resolves.toBe(
      "downloaded:https://example.com/thumb-new.jpg",
    );
    expect(networkClient.probe).toHaveBeenCalledTimes(1);
    expect(networkClient.download).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous image when a refreshed download fails validation", async () => {
    const { root, manager } = await createDownloadSubject({
      "thumb.jpg": "old-thumb",
    });
    mockImageValidation(false);
    const assets = await manager.downloadAll(
      root,
      createCrawlerData({
        thumb_url: "https://example.com/thumb-bad.jpg",
      }),
      createDownloadConfig({
        keepThumb: false,
        downloadPoster: false,
        downloadFanart: false,
        downloadSceneImages: false,
        downloadTrailer: false,
      }),
    );

    expect(assets.thumb).toBe(join(root, "thumb.jpg"));
    expect(assets.downloaded).toEqual([]);
    await expect(readFile(join(root, "thumb.jpg"), "utf8")).resolves.toBe("old-thumb");
  });

  it("replaces the scene image set when keepSceneImages is disabled", async () => {
    const { root, manager } = await createDownloadSubject({
      "extrafanart/fanart1.jpg": "old-1",
      "extrafanart/fanart2.jpg": "old-2",
    });
    mockImageValidation(true);
    const assets = await manager.downloadAll(
      root,
      createCrawlerData({
        sample_images: ["https://example.com/scene-new-1.jpg"],
      }),
      createDownloadConfig({
        downloadThumb: false,
        downloadPoster: false,
        downloadFanart: false,
        downloadTrailer: false,
        keepSceneImages: false,
      }),
    );

    expect(assets.sceneImages).toEqual([join(root, "extrafanart", "fanart1.jpg")]);
    expect(assets.downloaded).toEqual([join(root, "extrafanart", "fanart1.jpg")]);
    await expect(readFile(join(root, "extrafanart", "fanart1.jpg"), "utf8")).resolves.toBe(
      "downloaded:https://example.com/scene-new-1.jpg",
    );
    await expect(access(join(root, "extrafanart", "fanart2.jpg"))).rejects.toThrow();
  });

  it("keeps existing scene images when keepSceneImages is disabled but the current scrape has no scene sources", async () => {
    const { root, manager } = await createDownloadSubject({
      "extrafanart/fanart1.jpg": "old-1",
    });
    const assets = await manager.downloadAll(
      root,
      createCrawlerData({
        sample_images: [],
      }),
      createDownloadConfig({
        downloadThumb: false,
        downloadPoster: false,
        downloadFanart: false,
        downloadTrailer: false,
        keepSceneImages: false,
      }),
    );

    expect(assets.sceneImages).toEqual([join(root, "extrafanart", "fanart1.jpg")]);
    expect(assets.downloaded).toEqual([]);
    await expect(readFile(join(root, "extrafanart", "fanart1.jpg"), "utf8")).resolves.toBe("old-1");
  });

  it("removes existing scene images when maintenance explicitly replaces them with an empty set", async () => {
    const { root, manager } = await createDownloadSubject({
      "extrafanart/fanart1.jpg": "old-1",
    });
    const assets = await manager.downloadAll(
      root,
      createCrawlerData({
        sample_images: [],
      }),
      createDownloadConfig({
        downloadThumb: false,
        downloadPoster: false,
        downloadFanart: false,
        downloadTrailer: false,
        keepSceneImages: true,
      }),
      {},
      {
        assetDecisions: {
          sceneImages: "replace",
        },
      },
    );

    expect(assets.sceneImages).toEqual([]);
    expect(assets.downloaded).toEqual([]);
    await expect(access(join(root, "extrafanart", "fanart1.jpg"))).rejects.toThrow();
  });

  it("keeps the previous scene image when a refreshed download fails validation", async () => {
    const { root, manager } = await createDownloadSubject({
      "extrafanart/fanart1.jpg": "old-1",
    });
    mockImageValidation(false);
    const assets = await manager.downloadAll(
      root,
      createCrawlerData({
        sample_images: ["https://example.com/scene-bad-1.jpg"],
      }),
      createDownloadConfig({
        downloadThumb: false,
        downloadPoster: false,
        downloadFanart: false,
        downloadTrailer: false,
        keepSceneImages: false,
      }),
    );

    expect(assets.sceneImages).toEqual([join(root, "extrafanart", "fanart1.jpg")]);
    expect(assets.downloaded).toEqual([]);
    await expect(readFile(join(root, "extrafanart", "fanart1.jpg"), "utf8")).resolves.toBe("old-1");
  });

  it("refreshes a selected primary image even when the keep flag stays enabled", async () => {
    const { root, manager, networkClient } = await createDownloadSubject({
      "thumb.jpg": "old-thumb",
    });
    mockImageValidation(true);
    const assets = await manager.downloadAll(
      root,
      createCrawlerData({
        thumb_url: "https://example.com/thumb-new.jpg",
      }),
      createDownloadConfig({
        keepThumb: true,
        downloadPoster: false,
        downloadFanart: false,
        downloadSceneImages: false,
        downloadTrailer: false,
      }),
      {},
      {
        forceReplace: {
          thumb: true,
        },
      },
    );

    expect(assets.thumb).toBe(join(root, "thumb.jpg"));
    expect(assets.downloaded).toEqual([join(root, "thumb.jpg")]);
    await expect(readFile(join(root, "thumb.jpg"), "utf8")).resolves.toBe(
      "downloaded:https://example.com/thumb-new.jpg",
    );
    expect(networkClient.probe).toHaveBeenCalledTimes(1);
    expect(networkClient.download).toHaveBeenCalledTimes(1);
  });

  it("abandons a partial scene set and switches to the next set without mixing sources", async () => {
    const { root, manager, networkClient } = await createDownloadSubject();
    mockImageValidation(true);
    networkClient.download.mockImplementation(async (url: string, outputPath: string) => {
      if (url.includes("slow.example.com")) {
        throw new Error("Request timeout");
      }

      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `downloaded:${url}`, "utf8");
      return outputPath;
    });

    const config = createConfig({
      download: {
        ...defaultConfiguration.download,
        downloadThumb: false,
        downloadPoster: false,
        downloadFanart: false,
        downloadTrailer: false,
        keepSceneImages: false,
        sceneImageConcurrency: 1,
      },
      aggregation: {
        ...defaultConfiguration.aggregation,
        behavior: {
          ...defaultConfiguration.aggregation.behavior,
          maxSceneImages: 2,
        },
      },
    });

    const assets = await manager.downloadAll(
      root,
      createCrawlerData({
        sample_images: ["https://fast.example.com/set-a-1.jpg", "https://slow.example.com/set-a-2.jpg"],
      }),
      config,
      {
        sample_images: [["https://alt.example.com/set-b-1.jpg", "https://alt.example.com/set-b-2.jpg"]],
      },
    );

    expect(assets.sceneImages).toEqual([
      join(root, "extrafanart", "fanart1.jpg"),
      join(root, "extrafanart", "fanart2.jpg"),
    ]);
    await expect(readFile(join(root, "extrafanart", "fanart1.jpg"), "utf8")).resolves.toBe(
      "downloaded:https://alt.example.com/set-b-1.jpg",
    );
    await expect(readFile(join(root, "extrafanart", "fanart2.jpg"), "utf8")).resolves.toBe(
      "downloaded:https://alt.example.com/set-b-2.jpg",
    );
    expect(networkClient.download.mock.calls.map(([url]) => url)).toEqual([
      "https://fast.example.com/set-a-1.jpg",
      "https://slow.example.com/set-a-2.jpg",
      "https://alt.example.com/set-b-1.jpg",
      "https://alt.example.com/set-b-2.jpg",
    ]);
  });

  it("cools down a failing image host and skips remaining scene downloads for that host across runs", async () => {
    const storeRoot = await createTempDir();
    const storePath = join(storeRoot, "image-host-cooldowns.json");
    const hostStore = new PersistentCooldownStore({
      filePath: storePath,
      loggerName: "DownloadManagerHostCooldownTestStore",
    });
    const { root, manager, networkClient } = await createDownloadSubject({}, { imageHostCooldownStore: hostStore });
    mockImageValidation(true);
    networkClient.download.mockImplementation(async (url: string, outputPath: string) => {
      if (url.includes("blocked.example.com")) {
        throw new Error("Request timeout");
      }

      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `downloaded:${url}`, "utf8");
      return outputPath;
    });

    const config = createConfig({
      download: {
        ...defaultConfiguration.download,
        downloadThumb: false,
        downloadPoster: false,
        downloadFanart: false,
        downloadTrailer: false,
        keepSceneImages: false,
        sceneImageConcurrency: 1,
      },
      aggregation: {
        ...defaultConfiguration.aggregation,
        behavior: {
          ...defaultConfiguration.aggregation.behavior,
          maxSceneImages: 1,
        },
      },
    });

    const firstAssets = await manager.downloadAll(
      root,
      createCrawlerData({
        sample_images: ["https://blocked.example.com/scene-001.jpg"],
      }),
      config,
      {
        sample_images: [["https://blocked.example.com/scene-002.jpg"], ["https://cdn.example.com/scene-004.jpg"]],
      },
    );

    expect(firstAssets.sceneImages).toEqual([join(root, "extrafanart", "fanart1.jpg")]);
    expect(networkClient.download.mock.calls.map(([url]) => url)).toEqual([
      "https://blocked.example.com/scene-001.jpg",
      "https://blocked.example.com/scene-002.jpg",
      "https://cdn.example.com/scene-004.jpg",
    ]);

    await hostStore.flush();

    const secondRoot = await createTempDir();
    const reloadedStore = new PersistentCooldownStore({
      filePath: storePath,
      loggerName: "DownloadManagerHostCooldownTestStoreReloaded",
    });
    const reloadedManager = new DownloadManager(networkClient as unknown as NetworkClient, {
      imageHostCooldownStore: reloadedStore,
    });
    const callsBeforeSecondRun = networkClient.download.mock.calls.length;

    const secondAssets = await reloadedManager.downloadAll(
      secondRoot,
      createCrawlerData({
        sample_images: ["https://blocked.example.com/scene-005.jpg"],
      }),
      config,
      {
        sample_images: [["https://cdn.example.com/scene-006.jpg"]],
      },
    );

    expect(secondAssets.sceneImages).toEqual([join(secondRoot, "extrafanart", "fanart1.jpg")]);
    expect(networkClient.download).toHaveBeenCalledTimes(callsBeforeSecondRun + 1);
  });
});

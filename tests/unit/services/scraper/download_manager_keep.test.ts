import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
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

const createDownloadSubject = async (files: Record<string, string> = {}) => {
  const root = await createTempDir();
  await seedFiles(root, files);

  const networkClient = new FakeNetworkClient();
  const manager = new DownloadManager(networkClient as unknown as NetworkClient);

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

  it("uses thumb_url as the fanart source when a dedicated fanart is unavailable", async () => {
    const { root, manager, networkClient } = await createDownloadSubject();
    mockImageValidation(true);
    networkClient.probe.mockImplementation(async (url: string) => ({
      ok: true,
      status: 200,
      contentLength: url.endsWith("thumb-alt.jpg") ? 2048 : 1024,
      resolvedUrl: url,
    }));
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

    expect(assets.fanart).toBe(join(root, "fanart.jpg"));
    expect(assets.thumb).toBeUndefined();
    expect(assets.sceneImages).toEqual([
      join(root, "extrafanart", "fanart1.jpg"),
      join(root, "extrafanart", "fanart2.jpg"),
    ]);
    await expect(readFile(join(root, "fanart.jpg"), "utf8")).resolves.toBe(
      "downloaded:https://example.com/thumb-alt.jpg",
    );
    await expect(readFile(join(root, "extrafanart", "fanart1.jpg"), "utf8")).resolves.toBe(
      "downloaded:https://example.com/scene-001.jpg",
    );
    await expect(readFile(join(root, "extrafanart", "fanart2.jpg"), "utf8")).resolves.toBe(
      "downloaded:https://example.com/scene-002.jpg",
    );
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
});

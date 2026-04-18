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
  scene_images: [],
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

const createPrimaryImageConfig = () =>
  createDownloadConfig({
    keepThumb: false,
    keepPoster: false,
    downloadFanart: false,
    downloadSceneImages: false,
    downloadTrailer: false,
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

const writeDownloadedFile = async (outputPath: string, url: string): Promise<string> => {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `downloaded:${url}`, "utf8");
  return outputPath;
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

const mockResolutionAwarePrimaryValidation = () =>
  vi.spyOn(imageUtils, "validateImage").mockImplementation(async (filePath: string) => {
    const content = await readFile(filePath, "utf8");
    if (content.includes("thumb-tiny")) {
      return { valid: true, width: 400, height: 300 };
    }
    if (content.includes("thumb-low")) {
      return { valid: true, width: 800, height: 600 };
    }
    if (content.includes("thumb-high")) {
      return { valid: true, width: 1_600, height: 1_200 };
    }
    if (content.includes("poster-tiny")) {
      return { valid: true, width: 300, height: 450 };
    }
    if (content.includes("poster-low")) {
      return { valid: true, width: 600, height: 900 };
    }
    if (content.includes("poster-high")) {
      return { valid: true, width: 1_200, height: 1_800 };
    }

    return { valid: false, width: 0, height: 0, reason: "parse_failed" };
  });

const mockPrimaryProbe = (
  networkClient: FakeNetworkClient,
  options: {
    includeDimensions: boolean;
    withoutDimensions?: string[];
  },
) => {
  networkClient.probe.mockImplementation(async (url: string): Promise<ProbeResult> => {
    const variant = url.includes("-tiny.") ? "tiny" : url.includes("-low.") ? "low" : "high";
    const isThumb = url.includes("thumb");
    const shouldIncludeDimensions = options.includeDimensions && !options.withoutDimensions?.includes(url);
    return {
      ok: true,
      status: 200,
      contentLength: variant === "high" ? 20_000 : variant === "low" ? 10_000 : 1_000,
      resolvedUrl: url,
      ...(shouldIncludeDimensions
        ? {
            width:
              variant === "high"
                ? isThumb
                  ? 1_600
                  : 1_200
                : variant === "low"
                  ? isThumb
                    ? 800
                    : 600
                  : isThumb
                    ? 400
                    : 300,
            height:
              variant === "high"
                ? isThumb
                  ? 1_200
                  : 1_800
                : variant === "low"
                  ? isThumb
                    ? 600
                    : 900
                  : isThumb
                    ? 300
                    : 450,
          }
        : {}),
    };
  });
};

const downloadPrimaryAssets = (
  manager: DownloadManager,
  root: string,
  data: Partial<CrawlerData>,
  alternatives: { thumb_url?: string[]; poster_url?: string[] } = {},
) => manager.downloadAll(root, createCrawlerData(data), createPrimaryImageConfig(), alternatives);

const expectPrimaryAssets = async (
  root: string,
  assets: Awaited<ReturnType<DownloadManager["downloadAll"]>>,
  expectedThumbUrl: string,
  expectedPosterUrl: string,
) => {
  expect(assets.thumb).toBe(join(root, "thumb.jpg"));
  expect(assets.poster).toBe(join(root, "poster.jpg"));
  await expect(readFile(join(root, "thumb.jpg"), "utf8")).resolves.toBe(`downloaded:${expectedThumbUrl}`);
  await expect(readFile(join(root, "poster.jpg"), "utf8")).resolves.toBe(`downloaded:${expectedPosterUrl}`);
};

const sceneImagePath = (root: string, index: number) => join(root, "extrafanart", `fanart${index}.jpg`);

const expectSceneImages = async (
  root: string,
  assets: Awaited<ReturnType<DownloadManager["downloadAll"]>>,
  expectedUrls: string[],
) => {
  const expectedPaths = expectedUrls.map((_, index) => sceneImagePath(root, index + 1));
  expect(assets.sceneImages).toEqual(expectedPaths);

  await Promise.all(
    expectedUrls.map(async (url, index) => {
      const expectedPath = expectedPaths[index];
      if (!expectedPath) {
        throw new Error(`Missing expected path for scene image index ${index}`);
      }
      await expect(readFile(expectedPath, "utf8")).resolves.toBe(`downloaded:${url}`);
    }),
  );
};

class FakeNetworkClient {
  readonly download = vi.fn(async (url: string, outputPath: string) => await writeDownloadedFile(outputPath, url));

  readonly probe = vi.fn(
    async (url: string): Promise<ProbeResult> => ({
      ok: true,
      status: 200,
      contentLength: 1024,
      resolvedUrl: url,
    }),
  );
}

interface SecondaryArtworkCase {
  seed: Record<string, string>;
  data: CrawlerData;
  config: ReturnType<typeof createDownloadConfig>;
  alternatives: { thumb_url?: string[] };
  setup: (networkClient: FakeNetworkClient) => void;
  assert: (
    root: string,
    assets: Awaited<ReturnType<DownloadManager["downloadAll"]>>,
    networkClient: FakeNetworkClient,
  ) => Promise<void>;
}

interface SceneRefreshCase {
  seed: Record<string, string>;
  data: CrawlerData;
  config: ReturnType<typeof createDownloadConfig>;
  options: Parameters<DownloadManager["downloadAll"]>[4];
  setup: () => void;
  assert: (root: string, assets: Awaited<ReturnType<DownloadManager["downloadAll"]>>) => Promise<void>;
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

  it("names companion assets after the shared movie base when follow-video naming is enabled", async () => {
    const { root, manager } = await createDownloadSubject();
    mockImageValidation(true);
    const config = createConfig({
      naming: {
        ...defaultConfiguration.naming,
        assetNamingMode: "followVideo",
      },
      download: {
        ...defaultConfiguration.download,
        keepThumb: false,
        keepPoster: false,
        keepFanart: false,
        keepTrailer: false,
        downloadSceneImages: false,
      },
    });

    const assets = await manager.downloadAll(
      root,
      createCrawlerData({
        thumb_url: "https://example.com/thumb.jpg",
        poster_url: "https://example.com/poster.jpg",
        trailer_url: "https://example.com/trailer.mp4",
      }),
      config,
      {},
      undefined,
      {
        movieBaseName: "ABC-123-CEN",
      },
    );

    expect(assets.thumb).toBe(join(root, "ABC-123-CEN-thumb.jpg"));
    expect(assets.poster).toBe(join(root, "ABC-123-CEN-poster.jpg"));
    expect(assets.fanart).toBe(join(root, "ABC-123-CEN-fanart.jpg"));
    expect(assets.trailer).toBe(join(root, "ABC-123-CEN-trailer.mp4"));
    await expect(readFile(join(root, "ABC-123-CEN-thumb.jpg"), "utf8")).resolves.toBe(
      "downloaded:https://example.com/thumb.jpg",
    );
    await expect(readFile(join(root, "ABC-123-CEN-poster.jpg"), "utf8")).resolves.toBe(
      "downloaded:https://example.com/poster.jpg",
    );
    await expect(readFile(join(root, "ABC-123-CEN-trailer.mp4"), "utf8")).resolves.toBe(
      "downloaded:https://example.com/trailer.mp4",
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
        scene_images: ["https://example.com/scene-001.jpg"],
      }),
      createConfig(),
    );

    expect(assets.thumb).toBe(join(root, "thumb.jpg"));
    expect(assets.poster).toBe(join(root, "poster.jpg"));
    expect(assets.fanart).toBe(join(root, "fanart.jpg"));
    expect(assets.trailer).toBe(join(root, "trailer.mp4"));
    expect(assets.sceneImages).toEqual([sceneImagePath(root, 1)]);
    expect(assets.downloaded).toEqual([]);
    expect(networkClient.probe).not.toHaveBeenCalled();
    expect(networkClient.download).not.toHaveBeenCalled();
  });

  it("applies maintenance trailer replacement decisions", async () => {
    const cases = [
      {
        data: createCrawlerData({
          trailer_url: "https://example.com/trailer-new.mp4",
        }),
        expectedTrailer: join("unused", "trailer.mp4"),
        expectedDownloaded: true,
        expectedContent: "downloaded:https://example.com/trailer-new.mp4",
        expectedDownloadCalls: 1,
      },
      {
        data: createCrawlerData({
          trailer_url: undefined,
        }),
        expectedTrailer: undefined,
        expectedDownloaded: false,
        expectedContent: "old-trailer",
        expectedDownloadCalls: 0,
      },
    ];

    for (const { data, expectedTrailer, expectedDownloaded, expectedContent, expectedDownloadCalls } of cases) {
      vi.restoreAllMocks();
      const { root, manager, networkClient } = await createDownloadSubject({
        "trailer.mp4": "old-trailer",
      });

      const assets = await manager.downloadAll(
        root,
        data,
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

      expect(assets.trailer).toBe(expectedTrailer ? join(root, "trailer.mp4") : undefined);
      expect(assets.downloaded).toEqual(expectedDownloaded ? [join(root, "trailer.mp4")] : []);
      await expect(readFile(join(root, "trailer.mp4"), "utf8")).resolves.toBe(expectedContent);
      expect(networkClient.download).toHaveBeenCalledTimes(expectedDownloadCalls);
    }
  });

  it("keeps the first sample image for scene images when an existing fanart is reused", async () => {
    const { root, manager, networkClient } = await createDownloadSubject({
      "fanart.jpg": "fanart",
    });
    mockImageValidation(true);

    const sceneUrls = ["https://example.com/scene-001.jpg", "https://example.com/scene-002.jpg"];
    const assets = await manager.downloadAll(
      root,
      createCrawlerData({
        scene_images: sceneUrls,
      }),
      createDownloadConfig({
        downloadThumb: false,
        downloadPoster: false,
        downloadTrailer: false,
      }),
    );

    expect(assets.fanart).toBe(join(root, "fanart.jpg"));
    await expectSceneImages(root, assets, sceneUrls);
    expect(networkClient.download).toHaveBeenCalledTimes(2);
  });

  it("uses a smaller minimum byte threshold for scene images than primary artwork", async () => {
    const { root, manager } = await createDownloadSubject();
    vi.spyOn(imageUtils, "validateImage").mockImplementation(async (_filePath: string, minBytes = 8192) => {
      if (minBytes <= 4096) {
        return { valid: true, width: 640, height: 360 };
      }

      return { valid: false, width: 0, height: 0, reason: "file_too_small" };
    });

    const assets = await manager.downloadAll(
      root,
      createCrawlerData({
        scene_images: ["https://example.com/scene-001.jpg"],
      }),
      createDownloadConfig({
        downloadThumb: false,
        downloadPoster: false,
        downloadTrailer: false,
        downloadFanart: false,
      }),
    );

    await expectSceneImages(root, assets, ["https://example.com/scene-001.jpg"]);
  });

  it("saves downloaded WebP scene images with WebP file extensions", async () => {
    const { root, manager } = await createDownloadSubject({
      "extrafanart/fanart1.jpg": "old-scene",
    });
    vi.spyOn(imageUtils, "validateImage").mockResolvedValue({
      valid: true,
      width: 640,
      height: 360,
      format: "webp",
    });

    const assets = await manager.downloadAll(
      root,
      createCrawlerData({
        scene_images: ["https://example.com/scene-001.jpg"],
      }),
      createDownloadConfig({
        downloadThumb: false,
        downloadPoster: false,
        downloadFanart: false,
        downloadTrailer: false,
        keepSceneImages: false,
      }),
    );

    const scenePath = join(root, "extrafanart", "fanart1.webp");
    expect(assets.sceneImages).toEqual([scenePath]);
    expect(assets.downloaded).toEqual([scenePath]);
    await expect(readFile(scenePath, "utf8")).resolves.toBe("downloaded:https://example.com/scene-001.jpg");
    await expect(access(sceneImagePath(root, 1))).rejects.toThrow();
  });

  it("only derives secondary artwork when a kept thumb is actually available", async () => {
    const cases: SecondaryArtworkCase[] = [
      {
        seed: { "thumb.jpg": "thumb" },
        data: createCrawlerData(),
        config: createDownloadConfig({
          downloadTrailer: false,
          downloadSceneImages: false,
        }),
        alternatives: {},
        setup: (_networkClient: FakeNetworkClient) => {},
        assert: async (
          root: string,
          assets: Awaited<ReturnType<DownloadManager["downloadAll"]>>,
          networkClient: FakeNetworkClient,
        ) => {
          expect(assets.thumb).toBe(join(root, "thumb.jpg"));
          expect(assets.poster).toBeUndefined();
          expect(assets.fanart).toBe(join(root, "fanart.jpg"));
          expect(assets.downloaded).toEqual([join(root, "fanart.jpg")]);
          await expect(readFile(join(root, "fanart.jpg"), "utf8")).resolves.toBe("thumb");
          expect(networkClient.probe).not.toHaveBeenCalled();
          expect(networkClient.download).not.toHaveBeenCalled();
        },
      },
      {
        seed: {},
        data: createCrawlerData({
          thumb_url: "https://example.com/thumb.jpg",
          scene_images: ["https://example.com/scene-001.jpg", "https://example.com/scene-002.jpg"],
        }),
        config: createDownloadConfig({
          downloadThumb: false,
          downloadTrailer: false,
        }),
        alternatives: {
          thumb_url: ["https://example.com/thumb-alt.jpg"],
        },
        setup: (_networkClient: FakeNetworkClient) => {
          mockImageValidation(true);
        },
        assert: async (
          root: string,
          assets: Awaited<ReturnType<DownloadManager["downloadAll"]>>,
          networkClient: FakeNetworkClient,
        ) => {
          expect(assets.thumb).toBeUndefined();
          expect(assets.fanart).toBeUndefined();
          await expectSceneImages(root, assets, [
            "https://example.com/scene-001.jpg",
            "https://example.com/scene-002.jpg",
          ]);
          await expect(access(join(root, "fanart.jpg"))).rejects.toThrow();
          expect(networkClient.probe).not.toHaveBeenCalled();
          expect(networkClient.download).not.toHaveBeenCalledWith(
            "https://example.com/thumb-alt.jpg",
            expect.any(String),
          );
        },
      },
      {
        seed: {},
        data: createCrawlerData({
          scene_images: [
            "javascript:void(0)",
            "https://example.com/scene-001.jpg",
            "https://example.com/scene-002.jpg",
          ],
        }),
        config: createDownloadConfig({
          downloadThumb: false,
          downloadPoster: false,
          downloadTrailer: false,
        }),
        alternatives: {},
        setup: (_networkClient: FakeNetworkClient) => {
          mockImageValidation(true);
        },
        assert: async (
          root: string,
          assets: Awaited<ReturnType<DownloadManager["downloadAll"]>>,
          networkClient: FakeNetworkClient,
        ) => {
          expect(assets.fanart).toBeUndefined();
          await expectSceneImages(root, assets, [
            "https://example.com/scene-001.jpg",
            "https://example.com/scene-002.jpg",
          ]);
          await expect(access(join(root, "fanart.jpg"))).rejects.toThrow();
          expect(networkClient.download).not.toHaveBeenCalledWith("javascript:void(0)", expect.any(String));
        },
      },
      {
        seed: { "fanart.jpg": "fanart" },
        data: createCrawlerData(),
        config: createDownloadConfig({
          downloadPoster: false,
          downloadSceneImages: false,
          downloadTrailer: false,
        }),
        alternatives: {},
        setup: (_networkClient: FakeNetworkClient) => {},
        assert: async (
          root: string,
          assets: Awaited<ReturnType<DownloadManager["downloadAll"]>>,
          networkClient: FakeNetworkClient,
        ) => {
          expect(assets.fanart).toBe(join(root, "fanart.jpg"));
          expect(assets.thumb).toBeUndefined();
          await expect(access(join(root, "thumb.jpg"))).rejects.toThrow();
          expect(networkClient.probe).not.toHaveBeenCalled();
          expect(networkClient.download).not.toHaveBeenCalled();
        },
      },
    ];

    for (const { seed, data, config, alternatives, setup, assert } of cases) {
      vi.restoreAllMocks();
      const { root, manager, networkClient } = await createDownloadSubject(seed);
      setup(networkClient);

      const assets = await manager.downloadAll(root, data, config, alternatives);
      await assert(root, assets, networkClient);
    }
  });

  it("refreshes or preserves primary artwork according to keep and validation rules", async () => {
    const cases = [
      {
        setupValidation: () => mockImageValidation(true),
        config: createDownloadConfig({
          keepThumb: false,
          downloadPoster: false,
          downloadFanart: false,
          downloadSceneImages: false,
          downloadTrailer: false,
        }),
        options: undefined,
        expectedDownloaded: [join("unused", "thumb.jpg")],
        expectedContent: "downloaded:https://example.com/thumb-new.jpg",
        expectedProbeCalls: 1,
        expectedDownloadCalls: 1,
      },
      {
        setupValidation: () => mockImageValidation(false),
        config: createDownloadConfig({
          keepThumb: false,
          downloadPoster: false,
          downloadFanart: false,
          downloadSceneImages: false,
          downloadTrailer: false,
        }),
        options: undefined,
        expectedDownloaded: [],
        expectedContent: "old-thumb",
        expectedProbeCalls: 1,
        expectedDownloadCalls: 1,
      },
      {
        setupValidation: () => mockImageValidation(true),
        config: createDownloadConfig({
          keepThumb: true,
          downloadPoster: false,
          downloadFanart: false,
          downloadSceneImages: false,
          downloadTrailer: false,
        }),
        options: {
          forceReplace: {
            thumb: true,
          },
        },
        expectedDownloaded: [join("unused", "thumb.jpg")],
        expectedContent: "downloaded:https://example.com/thumb-new.jpg",
        expectedProbeCalls: 1,
        expectedDownloadCalls: 1,
      },
    ];

    for (const {
      setupValidation,
      config,
      options,
      expectedDownloaded,
      expectedContent,
      expectedProbeCalls,
      expectedDownloadCalls,
    } of cases) {
      vi.restoreAllMocks();
      const { root, manager, networkClient } = await createDownloadSubject({
        "thumb.jpg": "old-thumb",
      });
      setupValidation();

      const assets = await manager.downloadAll(
        root,
        createCrawlerData({
          thumb_url: "https://example.com/thumb-new.jpg",
        }),
        config,
        {},
        options,
      );

      expect(assets.thumb).toBe(join(root, "thumb.jpg"));
      expect(assets.downloaded).toEqual(expectedDownloaded.map(() => join(root, "thumb.jpg")));
      await expect(readFile(join(root, "thumb.jpg"), "utf8")).resolves.toBe(expectedContent);
      expect(networkClient.probe).toHaveBeenCalledTimes(expectedProbeCalls);
      expect(networkClient.download).toHaveBeenCalledTimes(expectedDownloadCalls);
    }
  });

  it("saves downloaded WebP artwork with WebP file extensions", async () => {
    const { root, manager } = await createDownloadSubject({
      "thumb.jpg": "old-thumb",
      "fanart.jpg": "old-fanart",
    });
    vi.spyOn(imageUtils, "validateImage").mockResolvedValue({
      valid: true,
      width: 640,
      height: 360,
      format: "webp",
    });

    const assets = await manager.downloadAll(
      root,
      createCrawlerData({
        thumb_url: "https://example.com/thumb.jpg",
        poster_url: "https://example.com/poster.jpg",
      }),
      createDownloadConfig({
        keepThumb: false,
        keepPoster: false,
        keepFanart: false,
        downloadSceneImages: false,
        downloadTrailer: false,
      }),
    );

    expect(assets.thumb).toBe(join(root, "thumb.webp"));
    expect(assets.poster).toBe(join(root, "poster.webp"));
    expect(assets.fanart).toBe(join(root, "fanart.webp"));
    expect(assets.downloaded).toEqual([join(root, "thumb.webp"), join(root, "poster.webp"), join(root, "fanart.webp")]);
    await expect(readFile(join(root, "thumb.webp"), "utf8")).resolves.toBe("downloaded:https://example.com/thumb.jpg");
    await expect(readFile(join(root, "poster.webp"), "utf8")).resolves.toBe(
      "downloaded:https://example.com/poster.jpg",
    );
    await expect(readFile(join(root, "fanart.webp"), "utf8")).resolves.toBe("downloaded:https://example.com/thumb.jpg");
    await expect(access(join(root, "thumb.jpg"))).rejects.toThrow();
    await expect(access(join(root, "fanart.jpg"))).rejects.toThrow();
  });

  it("uses probe metadata to minimize primary artwork downloads", async () => {
    const cases = [
      {
        setup: (networkClient: FakeNetworkClient) => {
          mockResolutionAwarePrimaryValidation();
          networkClient.probe.mockImplementation(async (url: string): Promise<ProbeResult> => {
            if (url.includes("-missing.")) {
              return {
                ok: false,
                status: 404,
                contentLength: null,
                resolvedUrl: url,
              };
            }

            return {
              ok: true,
              status: 200,
              contentLength: 20_000,
              resolvedUrl: url,
            };
          });
        },
        data: {
          thumb_url: "https://example.com/thumb-missing.jpg",
          poster_url: "https://example.com/poster-missing.jpg",
        },
        alternatives: {
          thumb_url: ["https://cdn.example.com/thumb-high.jpg"],
          poster_url: ["https://cdn.example.com/poster-high.jpg"],
        },
        expectedThumb: "https://cdn.example.com/thumb-high.jpg",
        expectedPoster: "https://cdn.example.com/poster-high.jpg",
        expectedProbeCalls: undefined,
        expectedDownloadCalls: ["https://cdn.example.com/thumb-high.jpg", "https://cdn.example.com/poster-high.jpg"],
        rejectedDownloads: ["https://example.com/thumb-missing.jpg", "https://example.com/poster-missing.jpg"],
      },
      {
        setup: (networkClient: FakeNetworkClient) => {
          mockPrimaryProbe(networkClient, { includeDimensions: false });
          mockResolutionAwarePrimaryValidation();
        },
        data: {
          thumb_url: "https://example.com/thumb-low.jpg",
          poster_url: "https://example.com/poster-low.jpg",
        },
        alternatives: {
          thumb_url: ["https://cdn.example.com/thumb-high.jpg"],
          poster_url: ["https://cdn.example.com/poster-high.jpg"],
        },
        expectedThumb: "https://cdn.example.com/thumb-high.jpg",
        expectedPoster: "https://cdn.example.com/poster-high.jpg",
        expectedProbeCalls: 4,
        expectedDownloadCalls: [
          "https://example.com/thumb-low.jpg",
          "https://cdn.example.com/thumb-high.jpg",
          "https://example.com/poster-low.jpg",
          "https://cdn.example.com/poster-high.jpg",
        ],
        rejectedDownloads: [],
      },
      {
        setup: (networkClient: FakeNetworkClient) => {
          mockPrimaryProbe(networkClient, {
            includeDimensions: true,
            withoutDimensions: ["https://cdn.example.com/thumb-high.jpg", "https://cdn.example.com/poster-high.jpg"],
          });
          mockResolutionAwarePrimaryValidation();
        },
        data: {
          thumb_url: "https://example.com/thumb-low.jpg",
          poster_url: "https://example.com/poster-low.jpg",
        },
        alternatives: {
          thumb_url: ["https://cdn.example.com/thumb-tiny.jpg", "https://cdn.example.com/thumb-high.jpg"],
          poster_url: ["https://cdn.example.com/poster-tiny.jpg", "https://cdn.example.com/poster-high.jpg"],
        },
        expectedThumb: "https://cdn.example.com/thumb-high.jpg",
        expectedPoster: "https://cdn.example.com/poster-high.jpg",
        expectedProbeCalls: 6,
        expectedDownloadCalls: [
          "https://example.com/thumb-low.jpg",
          "https://cdn.example.com/thumb-high.jpg",
          "https://example.com/poster-low.jpg",
          "https://cdn.example.com/poster-high.jpg",
        ],
        rejectedDownloads: ["https://cdn.example.com/thumb-tiny.jpg", "https://cdn.example.com/poster-tiny.jpg"],
      },
    ];

    for (const {
      setup,
      data,
      alternatives,
      expectedThumb,
      expectedPoster,
      expectedProbeCalls,
      expectedDownloadCalls,
      rejectedDownloads,
    } of cases) {
      vi.restoreAllMocks();
      const { root, manager, networkClient } = await createDownloadSubject();
      setup(networkClient);

      const assets = await downloadPrimaryAssets(manager, root, data, alternatives);
      await expectPrimaryAssets(root, assets, expectedThumb, expectedPoster);

      const downloadedUrls = networkClient.download.mock.calls.map(([url]) => url);
      expect(downloadedUrls).toEqual(expect.arrayContaining(expectedDownloadCalls));
      for (const rejectedUrl of rejectedDownloads) {
        expect(downloadedUrls).not.toEqual(expect.arrayContaining([rejectedUrl]));
      }
      if (expectedProbeCalls !== undefined) {
        expect(networkClient.probe).toHaveBeenCalledTimes(expectedProbeCalls);
      }
    }
  });

  it("replaces, retains, or clears scene image sets based on refresh intent and validation", async () => {
    const cases: SceneRefreshCase[] = [
      {
        seed: {
          "extrafanart/fanart1.jpg": "old-1",
          "extrafanart/fanart2.jpg": "old-2",
        },
        data: createCrawlerData({
          scene_images: ["https://example.com/scene-new-1.jpg"],
        }),
        config: createDownloadConfig({
          downloadThumb: false,
          downloadPoster: false,
          downloadFanart: false,
          downloadTrailer: false,
          keepSceneImages: false,
        }),
        options: undefined,
        setup: () => mockImageValidation(true),
        assert: async (root: string, assets: Awaited<ReturnType<DownloadManager["downloadAll"]>>) => {
          await expectSceneImages(root, assets, ["https://example.com/scene-new-1.jpg"]);
          expect(assets.downloaded).toEqual([sceneImagePath(root, 1)]);
          await expect(access(sceneImagePath(root, 2))).rejects.toThrow();
        },
      },
      {
        seed: {
          "extrafanart/fanart1.jpg": "old-1",
        },
        data: createCrawlerData({
          scene_images: [],
        }),
        config: createDownloadConfig({
          downloadThumb: false,
          downloadPoster: false,
          downloadFanart: false,
          downloadTrailer: false,
          keepSceneImages: false,
        }),
        options: undefined,
        setup: () => {},
        assert: async (root: string, assets: Awaited<ReturnType<DownloadManager["downloadAll"]>>) => {
          expect(assets.sceneImages).toEqual([sceneImagePath(root, 1)]);
          expect(assets.downloaded).toEqual([]);
          await expect(readFile(sceneImagePath(root, 1), "utf8")).resolves.toBe("old-1");
        },
      },
      {
        seed: {
          "extrafanart/fanart1.jpg": "old-1",
        },
        data: createCrawlerData({
          scene_images: [],
        }),
        config: createDownloadConfig({
          downloadThumb: false,
          downloadPoster: false,
          downloadFanart: false,
          downloadTrailer: false,
          keepSceneImages: true,
        }),
        options: {
          assetDecisions: {
            sceneImages: "replace" as const,
          },
        },
        setup: () => {},
        assert: async (root: string, assets: Awaited<ReturnType<DownloadManager["downloadAll"]>>) => {
          expect(assets.sceneImages).toEqual([]);
          expect(assets.downloaded).toEqual([]);
          await expect(access(sceneImagePath(root, 1))).rejects.toThrow();
        },
      },
      {
        seed: {
          "extrafanart/fanart1.jpg": "old-1",
        },
        data: createCrawlerData({
          scene_images: ["https://example.com/scene-bad-1.jpg"],
        }),
        config: createDownloadConfig({
          downloadThumb: false,
          downloadPoster: false,
          downloadFanart: false,
          downloadTrailer: false,
          keepSceneImages: false,
        }),
        options: undefined,
        setup: () => mockImageValidation(false),
        assert: async (root: string, assets: Awaited<ReturnType<DownloadManager["downloadAll"]>>) => {
          expect(assets.sceneImages).toEqual([sceneImagePath(root, 1)]);
          expect(assets.downloaded).toEqual([]);
          await expect(readFile(sceneImagePath(root, 1), "utf8")).resolves.toBe("old-1");
        },
      },
    ];

    for (const { seed, data, config, options, setup, assert } of cases) {
      vi.restoreAllMocks();
      const { root, manager } = await createDownloadSubject(seed);
      setup();

      const assets = await manager.downloadAll(root, data, config, {}, options);
      await assert(root, assets);
    }
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
        scene_images: ["https://fast.example.com/set-a-1.jpg", "https://slow.example.com/set-a-2.jpg"],
      }),
      config,
      {
        scene_images: [["https://alt.example.com/set-b-1.jpg", "https://alt.example.com/set-b-2.jpg"]],
      },
    );

    await expectSceneImages(root, assets, [
      "https://alt.example.com/set-b-1.jpg",
      "https://alt.example.com/set-b-2.jpg",
    ]);
    expect(networkClient.download.mock.calls.map(([url]) => url)).toEqual([
      "https://fast.example.com/set-a-1.jpg",
      "https://slow.example.com/set-a-2.jpg",
      "https://alt.example.com/set-b-1.jpg",
      "https://alt.example.com/set-b-2.jpg",
    ]);
  });

  it("keeps the scene image set with the most successful downloads when no set completes", async () => {
    const { root, manager, networkClient } = await createDownloadSubject();
    mockImageValidation(true);
    networkClient.download.mockImplementation(async (url: string, outputPath: string) => {
      if (url.endsWith("set-a-3.jpg") || url.endsWith("set-b-2.jpg") || url.endsWith("set-b-3.jpg")) {
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
          maxSceneImages: 3,
        },
      },
    });

    const assets = await manager.downloadAll(
      root,
      createCrawlerData({
        scene_images: [
          "https://best.example.com/set-a-1.jpg",
          "https://best.example.com/set-a-2.jpg",
          "https://best.example.com/set-a-3.jpg",
        ],
      }),
      config,
      {
        scene_images: [
          [
            "https://fallback.example.com/set-b-1.jpg",
            "https://fallback.example.com/set-b-2.jpg",
            "https://fallback.example.com/set-b-3.jpg",
          ],
        ],
      },
    );

    await expectSceneImages(root, assets, [
      "https://best.example.com/set-a-1.jpg",
      "https://best.example.com/set-a-2.jpg",
    ]);
    await expect(access(sceneImagePath(root, 3))).rejects.toThrow();
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
        scene_images: ["https://blocked.example.com/scene-001.jpg"],
      }),
      config,
      {
        scene_images: [["https://blocked.example.com/scene-002.jpg"], ["https://cdn.example.com/scene-004.jpg"]],
      },
    );

    expect(firstAssets.sceneImages).toEqual([sceneImagePath(root, 1)]);
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
        scene_images: ["https://blocked.example.com/scene-005.jpg"],
      }),
      config,
      {
        scene_images: [["https://cdn.example.com/scene-006.jpg"]],
      },
    );

    expect(secondAssets.sceneImages).toEqual([sceneImagePath(secondRoot, 1)]);
    expect(networkClient.download).toHaveBeenCalledTimes(callsBeforeSecondRun + 1);
  });
});

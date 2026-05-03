import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActorImageService, getActorImageCacheDirectory } from "@main/services/ActorImageService";
import type { ActorSourceProvider } from "@main/services/actorSource";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { SignalService } from "@main/services/SignalService";
import type { AggregationService } from "@main/services/scraper/aggregation";
import type { DownloadManager } from "@main/services/scraper/DownloadManager";
import { createFileScraper } from "@main/services/scraper/FileScraper";
import type { NfoGenerator } from "@main/services/scraper/NfoGenerator";
import * as imageUtils from "@main/utils/image";
import type { FileOrganizer, OrganizePlan, TranslateService } from "@mdcz/runtime/scrape";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import { app } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockConfigManager } from "./helpers";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-file-scraper-actors-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const createUserDataDir = async (): Promise<string> => {
  const userDataDir = await createTempDir();
  vi.spyOn(app, "getPath").mockReturnValue(userDataDir);
  return userDataDir;
};

const readValidPngBytes = async (): Promise<Buffer> => readFile(join(process.cwd(), "apps/desktop/build/icon.png"));

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Sample Title",
  number: "ABC-123",
  actors: ["Actor A", "Actor B"],
  actor_profiles: [
    { name: "Actor A", photo_url: "https://img.example.com/actor-a.jpg" },
    { name: "Actor B", photo_url: "https://img.example.com/actor-b.jpg" },
  ],
  genres: [],
  scene_images: [],
  website: Website.DMM,
  ...overrides,
});

const createAggregationResult = (data: CrawlerData) => ({
  data,
  sources: {},
  imageAlternatives: {
    thumb_url: [],
    poster_url: [],
    fanart_url: [],
    scene_images: [],
  },
  stats: {
    totalSites: 1,
    successCount: 1,
    failedCount: 0,
    skippedCount: 0,
    siteResults: [],
    totalElapsedMs: 1,
  },
});

describe("FileScraper actor image library", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
    );
  });

  it("writes local actor thumbs into .actors before NFO generation", async () => {
    const root = await createTempDir();
    await createUserDataDir();
    const actorLibraryDir = join(root, "actor-library");
    const actorCacheDir = getActorImageCacheDirectory();
    const outputDir = join(root, "output", "ABC-123");
    const manualActorPath = join(actorLibraryDir, "Actor A.jpg");
    const actorImageService = new ActorImageService();
    const plan: OrganizePlan = {
      outputDir,
      targetVideoPath: join(outputDir, "ABC-123.mp4"),
      nfoPath: join(outputDir, "ABC-123.nfo"),
    };

    await mkdir(actorLibraryDir, { recursive: true });
    await writeFile(manualActorPath, "manual-a", "utf8");

    const config = configurationSchema.parse({
      ...defaultConfiguration,
      download: {
        ...defaultConfiguration.download,
        generateNfo: true,
      },
      paths: {
        ...defaultConfiguration.paths,
        actorPhotoFolder: actorLibraryDir,
      },
    });
    const writeNfo = vi.fn().mockResolvedValue(plan.nfoPath);
    mockConfigManager(config);
    const scraper = createFileScraper({
      aggregationService: {
        aggregate: vi.fn().mockResolvedValue(createAggregationResult(createCrawlerData())),
      } as unknown as AggregationService,
      translateService: {
        translateCrawlerData: vi.fn(async (data: CrawlerData) => data),
      } as unknown as TranslateService,
      nfoGenerator: {
        writeNfo,
      } as unknown as NfoGenerator,
      downloadManager: {
        downloadAll: vi.fn().mockResolvedValue({
          downloaded: [],
          sceneImages: [],
        }),
      } as unknown as DownloadManager,
      fileOrganizer: {
        plan: vi.fn().mockReturnValue(plan),
        ensureOutputReady: vi.fn().mockImplementation(async (plan: OrganizePlan) => plan),
        organizeVideo: vi.fn().mockResolvedValue(join(outputDir, "ABC-123.mp4")),
      } as unknown as FileOrganizer,
      signalService: new SignalService(null),
      actorImageService,
    });

    const result = await scraper.scrapeFile(join(root, "ABC-123.mp4"), { fileIndex: 1, totalFiles: 1 });
    const preparedData = writeNfo.mock.calls[0]?.[1] as CrawlerData;
    const index = JSON.parse(await readFile(join(actorCacheDir, "index.json"), "utf8")) as {
      actors: Record<string, { publicFileName?: string }>;
    };

    expect(result.status).toBe("success");
    expect(preparedData.actor_profiles).toEqual([
      { name: "Actor A", photo_url: ".actors/Actor A.jpg" },
      { name: "Actor B", photo_url: undefined },
    ]);
    expect(await readFile(join(outputDir, ".actors", "Actor A.jpg"), "utf8")).toBe("manual-a");
    expect(index.actors.actora).toMatchObject({
      publicFileName: "Actor A.jpg",
    });
    await expect(readFile(join(actorCacheDir, "queue.json"), "utf8")).rejects.toThrow();
  });

  it("materializes actor thumbs even when NFO generation is disabled", async () => {
    const root = await createTempDir();
    await createUserDataDir();
    const actorLibraryDir = join(root, "actor-library");
    const outputDir = join(root, "output", "ABC-123");
    const manualActorPath = join(actorLibraryDir, "Actor A.jpg");
    const plan: OrganizePlan = {
      outputDir,
      targetVideoPath: join(outputDir, "ABC-123.mp4"),
      nfoPath: join(outputDir, "ABC-123.nfo"),
    };

    await mkdir(actorLibraryDir, { recursive: true });
    await writeFile(manualActorPath, "manual-a", "utf8");

    const config = configurationSchema.parse({
      ...defaultConfiguration,
      download: {
        ...defaultConfiguration.download,
        generateNfo: false,
      },
      paths: {
        ...defaultConfiguration.paths,
        actorPhotoFolder: actorLibraryDir,
      },
    });
    const writeNfo = vi.fn();
    mockConfigManager(config);
    const scraper = createFileScraper({
      aggregationService: {
        aggregate: vi.fn().mockResolvedValue(createAggregationResult(createCrawlerData())),
      } as unknown as AggregationService,
      translateService: {
        translateCrawlerData: vi.fn(async (data: CrawlerData) => data),
      } as unknown as TranslateService,
      nfoGenerator: {
        writeNfo,
      } as unknown as NfoGenerator,
      downloadManager: {
        downloadAll: vi.fn().mockResolvedValue({
          downloaded: [],
          sceneImages: [],
        }),
      } as unknown as DownloadManager,
      fileOrganizer: {
        plan: vi.fn().mockReturnValue(plan),
        ensureOutputReady: vi.fn().mockImplementation(async (nextPlan: OrganizePlan) => nextPlan),
        organizeVideo: vi.fn().mockResolvedValue(join(outputDir, "ABC-123.mp4")),
      } as unknown as FileOrganizer,
      signalService: new SignalService(null),
      actorImageService: new ActorImageService(),
    });

    const result = await scraper.scrapeFile(join(root, "ABC-123.mp4"), { fileIndex: 1, totalFiles: 1 });

    expect(result.status).toBe("success");
    expect(writeNfo).not.toHaveBeenCalled();
    expect(await readFile(join(outputDir, ".actors", "Actor A.jpg"), "utf8")).toBe("manual-a");
    expect(result.crawlerData?.actor_profiles).toEqual([
      { name: "Actor A", photo_url: ".actors/Actor A.jpg" },
      { name: "Actor B", photo_url: undefined },
    ]);
  });

  it("downloads remote actor thumbs into the program cache before NFO generation when no manual image exists", async () => {
    const root = await createTempDir();
    await createUserDataDir();
    const actorLibraryDir = join(root, "actor-library");
    const actorCacheDir = getActorImageCacheDirectory();
    const outputDir = join(root, "output", "ABC-123");
    const nfoPath = join(outputDir, "ABC-123.nfo");
    const validPngBytes = await readValidPngBytes();
    vi.spyOn(imageUtils, "validateImage").mockResolvedValue({
      valid: true,
      width: 512,
      height: 512,
    });
    const actorImageService = new ActorImageService({
      networkClient: {
        getContent: vi.fn(async () => validPngBytes),
      },
    });
    const plan: OrganizePlan = {
      outputDir,
      targetVideoPath: join(outputDir, "ABC-123.mp4"),
      nfoPath,
    };

    await mkdir(actorLibraryDir, { recursive: true });

    const config = configurationSchema.parse({
      ...defaultConfiguration,
      download: {
        ...defaultConfiguration.download,
        generateNfo: true,
      },
      paths: {
        ...defaultConfiguration.paths,
        actorPhotoFolder: actorLibraryDir,
      },
    });
    const writeNfo = vi.fn().mockResolvedValue(nfoPath);
    mockConfigManager(config);
    const scraper = createFileScraper({
      aggregationService: {
        aggregate: vi.fn().mockResolvedValue(
          createAggregationResult(
            createCrawlerData({
              actors: ["Actor B"],
              actor_profiles: [{ name: "Actor B", photo_url: "https://img.example.com/actor-b.png" }],
            }),
          ),
        ),
      } as unknown as AggregationService,
      translateService: {
        translateCrawlerData: vi.fn(async (data: CrawlerData) => data),
      } as unknown as TranslateService,
      nfoGenerator: {
        writeNfo,
      } as unknown as NfoGenerator,
      downloadManager: {
        downloadAll: vi.fn().mockResolvedValue({
          downloaded: [],
          sceneImages: [],
        }),
      } as unknown as DownloadManager,
      fileOrganizer: {
        plan: vi.fn().mockReturnValue(plan),
        ensureOutputReady: vi.fn().mockImplementation(async (nextPlan: OrganizePlan) => nextPlan),
        organizeVideo: vi.fn().mockResolvedValue(join(outputDir, "ABC-123.mp4")),
      } as unknown as FileOrganizer,
      signalService: new SignalService(null),
      actorImageService,
    });

    const result = await scraper.scrapeFile(join(root, "ABC-123.mp4"), { fileIndex: 1, totalFiles: 1 });
    const preparedData = writeNfo.mock.calls[0]?.[1] as CrawlerData;
    const index = JSON.parse(await readFile(join(actorCacheDir, "index.json"), "utf8")) as {
      actors: Record<string, { blobRelativePath?: string }>;
    };

    expect(result.status).toBe("success");
    expect(preparedData.actor_profiles).toEqual([{ name: "Actor B", photo_url: ".actors/Actor B.png" }]);
    expect(await readFile(join(outputDir, ".actors", "Actor B.png"))).toEqual(validPngBytes);
    expect(index.actors.actorb.blobRelativePath).toBeTruthy();
  });

  it("refreshes stale cached actor blobs when the legacy cache entry has no source URL", async () => {
    const root = await createTempDir();
    await createUserDataDir();
    const actorLibraryDir = join(root, "actor-library");
    const actorCacheDir = getActorImageCacheDirectory();
    const outputDir = join(root, "output", "ABC-123");
    const validPngBytes = await readValidPngBytes();
    vi.spyOn(imageUtils, "validateImage").mockResolvedValue({
      valid: true,
      width: 512,
      height: 512,
    });
    const actorImageService = new ActorImageService({
      networkClient: {
        getContent: vi.fn(async () => validPngBytes),
      },
    });

    await mkdir(join(actorCacheDir, "blobs", "sha256", "aa"), { recursive: true });
    await writeFile(join(actorCacheDir, "blobs", "sha256", "aa", "stale.jpg"), "stale-blob", "utf8");
    await writeFile(
      join(actorCacheDir, "index.json"),
      `${JSON.stringify(
        {
          version: 1,
          actors: {
            actorb: {
              normalizedName: "actorb",
              displayName: "Actor B",
              aliases: [],
              blobRelativePath: "blobs\\sha256\\aa\\stale.jpg",
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = configurationSchema.parse({
      ...defaultConfiguration,
      paths: {
        ...defaultConfiguration.paths,
        actorPhotoFolder: actorLibraryDir,
      },
    });

    const preparedProfiles = await actorImageService.prepareActorProfilesForMovie(config, {
      movieDir: outputDir,
      actors: ["Actor B"],
      actorProfiles: [{ name: "Actor B", photo_url: "https://img.example.com/actor-b.png" }],
    });

    const index = JSON.parse(await readFile(join(actorCacheDir, "index.json"), "utf8")) as {
      actors: Record<string, { blobRelativePath?: string; sourceUrl?: string }>;
    };

    expect(preparedProfiles).toEqual([{ name: "Actor B", photo_url: ".actors/Actor B.png" }]);
    expect(await readFile(join(outputDir, ".actors", "Actor B.png"))).toEqual(validPngBytes);
    expect(index.actors.actorb.sourceUrl).toBe("https://img.example.com/actor-b.png");
    expect(index.actors.actorb.blobRelativePath).not.toBe("blobs\\sha256\\aa\\stale.jpg");
  });

  it("hydrates actor profile photos from actor sources when crawlers only return actor names", async () => {
    const root = await createTempDir();
    await createUserDataDir();
    const actorLibraryDir = join(root, "actor-library");
    const outputDir = join(root, "output", "ABC-123");
    const nfoPath = join(outputDir, "ABC-123.nfo");
    const validPngBytes = await readValidPngBytes();
    vi.spyOn(imageUtils, "validateImage").mockResolvedValue({
      valid: true,
      width: 512,
      height: 512,
    });
    const actorImageService = new ActorImageService({
      networkClient: {
        getContent: vi.fn(async () => validPngBytes),
      },
    });
    const actorSourceProvider = {
      lookup: vi.fn().mockResolvedValue({
        profile: {
          name: "Actor C",
          photo_url: "https://img.example.com/actor-c.png",
        },
        profileSources: {
          photo_url: "official",
        },
        sourceResults: [],
        warnings: [],
      }),
    } as unknown as ActorSourceProvider;
    const plan: OrganizePlan = {
      outputDir,
      targetVideoPath: join(outputDir, "ABC-123.mp4"),
      nfoPath,
    };

    await mkdir(actorLibraryDir, { recursive: true });

    const config = configurationSchema.parse({
      ...defaultConfiguration,
      download: {
        ...defaultConfiguration.download,
        generateNfo: true,
      },
      paths: {
        ...defaultConfiguration.paths,
        actorPhotoFolder: actorLibraryDir,
      },
    });
    const writeNfo = vi.fn().mockResolvedValue(nfoPath);
    mockConfigManager(config);
    const scraper = createFileScraper({
      aggregationService: {
        aggregate: vi.fn().mockResolvedValue(
          createAggregationResult(
            createCrawlerData({
              actors: ["Actor C"],
              actor_profiles: undefined,
            }),
          ),
        ),
      } as unknown as AggregationService,
      translateService: {
        translateCrawlerData: vi.fn(async (data: CrawlerData) => data),
      } as unknown as TranslateService,
      nfoGenerator: {
        writeNfo,
      } as unknown as NfoGenerator,
      downloadManager: {
        downloadAll: vi.fn().mockResolvedValue({
          downloaded: [],
          sceneImages: [],
        }),
      } as unknown as DownloadManager,
      fileOrganizer: {
        plan: vi.fn().mockReturnValue(plan),
        ensureOutputReady: vi.fn().mockImplementation(async (nextPlan: OrganizePlan) => nextPlan),
        organizeVideo: vi.fn().mockResolvedValue(join(outputDir, "ABC-123.mp4")),
      } as unknown as FileOrganizer,
      signalService: new SignalService(null),
      actorImageService,
      actorSourceProvider,
    });

    const result = await scraper.scrapeFile(join(root, "ABC-123.mp4"), { fileIndex: 1, totalFiles: 1 });
    const preparedData = writeNfo.mock.calls[0]?.[1] as CrawlerData;

    expect(result.status).toBe("success");
    expect(actorSourceProvider.lookup).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        name: "Actor C",
        requiredField: "photo_url",
      }),
    );
    expect(preparedData.actor_profiles).toEqual([{ name: "Actor C", photo_url: ".actors/Actor C.png" }]);
    expect(await readFile(join(outputDir, ".actors", "Actor C.png"))).toEqual(validPngBytes);
  });
});

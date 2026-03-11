import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActorImageService, getActorImageCacheDirectory } from "@main/services/ActorImageService";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { SignalService } from "@main/services/SignalService";
import type { AggregationService } from "@main/services/scraper/aggregation";
import type { DownloadManager } from "@main/services/scraper/DownloadManager";
import type { FileOrganizer, OrganizePlan } from "@main/services/scraper/FileOrganizer";
import { FileScraper } from "@main/services/scraper/FileScraper";
import type { NfoGenerator } from "@main/services/scraper/NfoGenerator";
import type { TranslateService } from "@main/services/scraper/TranslateService";
import * as imageUtils from "@main/utils/image";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import { app } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestConfigManager } from "./helpers";

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

const readValidPngBytes = async (): Promise<Buffer> => readFile(join(process.cwd(), "build", "icon.png"));

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Sample Title",
  number: "ABC-123",
  actors: ["Actor A", "Actor B"],
  actor_profiles: [
    { name: "Actor A", photo_url: "https://img.example.com/actor-a.jpg" },
    { name: "Actor B", photo_url: "https://img.example.com/actor-b.jpg" },
  ],
  genres: [],
  sample_images: [],
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
  },
  stats: {
    totalSites: 1,
    successCount: 1,
    failedCount: 0,
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
        downloadNfo: true,
      },
      paths: {
        ...defaultConfiguration.paths,
        actorPhotoFolder: actorLibraryDir,
      },
    });
    const writeNfo = vi.fn().mockResolvedValue(plan.nfoPath);
    const scraper = new FileScraper({
      configManager: new TestConfigManager(config),
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
        downloadNfo: true,
      },
      paths: {
        ...defaultConfiguration.paths,
        actorPhotoFolder: actorLibraryDir,
      },
    });
    const writeNfo = vi.fn().mockResolvedValue(nfoPath);
    const scraper = new FileScraper({
      configManager: new TestConfigManager(config),
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
});

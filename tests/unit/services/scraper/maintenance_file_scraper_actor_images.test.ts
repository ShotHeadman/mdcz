import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActorImageService, getActorImageCacheDirectory } from "@main/services/ActorImageService";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { SignalService } from "@main/services/SignalService";
import type { DownloadManager } from "@main/services/scraper/DownloadManager";
import type { FileOrganizer, OrganizePlan } from "@main/services/scraper/FileOrganizer";
import { MaintenanceFileScraper } from "@main/services/scraper/maintenance/MaintenanceFileScraper";
import { getPreset } from "@main/services/scraper/maintenance/presets";
import type { NfoGenerator } from "@main/services/scraper/NfoGenerator";
import type { TranslateService } from "@main/services/scraper/TranslateService";
import * as imageUtils from "@main/utils/image";
import { Website } from "@shared/enums";
import type { CrawlerData, LocalScanEntry } from "@shared/types";
import { app } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestConfigManager } from "./helpers";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-maintenance-file-scraper-"));
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
  actors: ["Actor A"],
  actor_profiles: [{ name: "Actor A", photo_url: "https://img.example.com/actor-a.png" }],
  genres: [],
  sample_images: [],
  website: Website.DMM,
  ...overrides,
});

const createEntry = (root: string, crawlerData: CrawlerData): LocalScanEntry => ({
  id: "entry-1",
  videoPath: join(root, "ABC-123.mp4"),
  fileInfo: {
    filePath: join(root, "ABC-123.mp4"),
    fileName: "ABC-123.mp4",
    extension: ".mp4",
    number: "ABC-123",
    isSubtitled: false,
  },
  nfoPath: join(root, "ABC-123.nfo"),
  crawlerData,
  assets: {
    sceneImages: [],
    actorPhotos: [],
    nfo: join(root, "ABC-123.nfo"),
  },
  currentDir: root,
});

const createPlan = (root: string): OrganizePlan => {
  const outputDir = join(root, "output", "ABC-123");
  return {
    outputDir,
    targetVideoPath: join(outputDir, "ABC-123.mp4"),
    nfoPath: join(outputDir, "ABC-123.nfo"),
  };
};

const createScraperHarness = (
  root: string,
  options: {
    actorImageService?: ActorImageService;
    config?: ReturnType<typeof configurationSchema.parse>;
    downloadAll?: ReturnType<typeof vi.fn>;
    writeNfo?: ReturnType<typeof vi.fn>;
  } = {},
) => {
  const plan = createPlan(root);
  const config = options.config ?? configurationSchema.parse(defaultConfiguration);
  const downloadAll =
    options.downloadAll ??
    vi.fn().mockResolvedValue({
      downloaded: [],
      sceneImages: [],
    });
  const writeNfo = options.writeNfo ?? vi.fn().mockResolvedValue(plan.nfoPath);
  const actorImageService = options.actorImageService ?? new ActorImageService();

  const scraper = new MaintenanceFileScraper(
    {
      configManager: new TestConfigManager(config),
      aggregationService: {
        aggregate: vi.fn(),
      } as never,
      translateService: {
        translateCrawlerData: vi.fn(async (data: CrawlerData) => data),
      } as unknown as TranslateService,
      nfoGenerator: {
        writeNfo,
      } as unknown as NfoGenerator,
      downloadManager: {
        downloadAll,
      } as unknown as DownloadManager,
      fileOrganizer: {
        plan: vi.fn().mockReturnValue(plan),
        resolveOutputPlan: vi.fn().mockImplementation(async (nextPlan: OrganizePlan) => nextPlan),
        organizeVideo: vi.fn().mockResolvedValue(plan.targetVideoPath),
      } as unknown as FileOrganizer,
      signalService: new SignalService(null),
      actorImageService,
    },
    getPreset("refresh_data"),
  );

  return { scraper, plan, config, downloadAll, writeNfo, actorImageService };
};

describe("MaintenanceFileScraper actor image parity", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
    );
  });

  it("materializes actor thumbnails before maintenance NFO generation", async () => {
    const root = await createTempDir();
    await createUserDataDir();
    const actorLibraryDir = join(root, "actor-library");
    const actorCacheDir = getActorImageCacheDirectory();
    const actorImageService = new ActorImageService();
    const config = configurationSchema.parse({
      ...defaultConfiguration,
      paths: {
        ...defaultConfiguration.paths,
        actorPhotoFolder: actorLibraryDir,
      },
    });
    const manualActorPath = join(actorLibraryDir, "Actor A.jpg");

    await mkdir(actorLibraryDir, { recursive: true });
    await writeFile(manualActorPath, "manual-a", "utf8");

    const { scraper, plan, writeNfo } = createScraperHarness(root, {
      actorImageService,
      config,
    });
    const outputDir = plan.outputDir;

    const result = await scraper.processFile(
      createEntry(root, createCrawlerData()),
      config,
      { fileIndex: 1, totalFiles: 1 },
      undefined,
      {
        crawlerData: createCrawlerData(),
      },
    );
    const preparedData = writeNfo.mock.calls[0]?.[1] as CrawlerData;
    const index = JSON.parse(await readFile(join(actorCacheDir, "index.json"), "utf8")) as {
      actors: Record<string, { publicFileName?: string }>;
    };

    expect(result.scrapeResult.status).toBe("success");
    expect(preparedData.actor_profiles).toEqual([{ name: "Actor A", photo_url: ".actors/Actor A.jpg" }]);
    expect(result.updatedEntry?.assets.actorPhotos).toEqual([join(outputDir, ".actors", "Actor A.jpg")]);
    expect(await readFile(join(outputDir, ".actors", "Actor A.jpg"), "utf8")).toBe("manual-a");
    expect(index.actors.actora).toMatchObject({
      publicFileName: "Actor A.jpg",
    });
  });

  it("forces refreshed thumb and derived fanart when the committed thumb URL changes", async () => {
    const root = await createTempDir();
    await createUserDataDir();
    const downloadAll = vi.fn().mockResolvedValue({
      thumb: join(root, "output", "ABC-123", "thumb.jpg"),
      downloaded: [join(root, "output", "ABC-123", "thumb.jpg")],
      sceneImages: [],
    });
    const { scraper, config } = createScraperHarness(root, {
      downloadAll,
    });

    const oldData = createCrawlerData({
      thumb_url: "https://example.com/thumb-old.jpg",
    });
    const newData = createCrawlerData({
      thumb_url: "https://example.com/thumb-new.jpg",
    });

    await scraper.processFile(createEntry(root, oldData), config, { fileIndex: 1, totalFiles: 1 }, undefined, {
      crawlerData: newData,
    });

    const downloadOptions = downloadAll.mock.calls[0]?.[4];
    expect(downloadOptions).toEqual(
      expect.objectContaining({
        forceReplace: expect.objectContaining({
          thumb: true,
          fanart: true,
        }),
      }),
    );
  });

  it("caches remote actor thumbnails for maintenance rewrites when no manual image exists", async () => {
    const root = await createTempDir();
    await createUserDataDir();
    const actorLibraryDir = join(root, "actor-library");
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
    const config = configurationSchema.parse({
      ...defaultConfiguration,
      paths: {
        ...defaultConfiguration.paths,
        actorPhotoFolder: actorLibraryDir,
      },
    });

    await mkdir(actorLibraryDir, { recursive: true });

    const { scraper, plan, writeNfo } = createScraperHarness(root, {
      actorImageService,
      config,
    });

    await scraper.processFile(
      createEntry(root, createCrawlerData()),
      config,
      { fileIndex: 1, totalFiles: 1 },
      undefined,
      {
        crawlerData: createCrawlerData(),
      },
    );
    const preparedData = writeNfo.mock.calls[0]?.[1] as CrawlerData;

    expect(preparedData.actor_profiles).toEqual([{ name: "Actor A", photo_url: ".actors/Actor A.png" }]);
    expect(await readFile(join(plan.outputDir, ".actors", "Actor A.png"))).toEqual(validPngBytes);
  });
});

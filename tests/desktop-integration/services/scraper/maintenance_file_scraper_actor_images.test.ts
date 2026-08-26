import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { SignalService } from "@main/services/SignalService";
import type { DownloadManager } from "@main/services/scraper/DownloadManager";
import type { NfoGenerator } from "@main/services/scraper/NfoGenerator";
import { getMaintenancePreset as getPreset } from "@mdcz/runtime/maintenance";
import { MaintenanceFileScraper } from "@mdcz/runtime/maintenance/MaintenanceFileScraper";
import type { FileOrganizer, OrganizePlan, TranslateService } from "@mdcz/runtime/scrape";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData, LocalScanEntry } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-maintenance-file-scraper-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Sample Title",
  number: "ABC-123",
  actors: [],
  genres: [],
  scene_images: [],
  website: Website.DMM,
  ...overrides,
});

const createEntry = (
  root: string,
  crawlerData: CrawlerData,
  overrides: Partial<LocalScanEntry> = {},
): LocalScanEntry => ({
  fileId: "entry-1",
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
    ...(overrides.assets ?? {}),
  },
  currentDir: root,
  ...overrides,
});

const createScraperHarness = (root: string, downloadAll: ReturnType<typeof vi.fn>) => {
  const outputDir = join(root, "output", "ABC-123");
  const plan: OrganizePlan = {
    outputDir,
    targetVideoPath: join(outputDir, "ABC-123.mp4"),
    nfoPath: join(outputDir, "ABC-123.nfo"),
  };
  const config = configurationSchema.parse(defaultConfiguration);
  const scraper = new MaintenanceFileScraper(
    {
      aggregationService: { aggregate: vi.fn() } as never,
      translateService: {
        translateCrawlerData: vi.fn(async (data: CrawlerData) => data),
      } as unknown as TranslateService,
      nfoGenerator: { writeNfo: vi.fn().mockResolvedValue(plan.nfoPath) } as unknown as NfoGenerator,
      downloadManager: { downloadAll } as unknown as DownloadManager,
      fileOrganizer: {
        plan: vi.fn().mockReturnValue(plan),
        resolveOutputPlan: vi.fn().mockImplementation(async (nextPlan: OrganizePlan) => nextPlan),
        organizeVideo: vi.fn().mockResolvedValue(plan.targetVideoPath),
      } as unknown as FileOrganizer,
      signalService: new SignalService(null),
      actorImageService: {
        prepareActorProfilesForMovie: vi.fn().mockResolvedValue(undefined),
      } as never,
    },
    getPreset("refresh_data"),
  );

  return { scraper, config };
};

describe("MaintenanceFileScraper asset replacement", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
    );
  });

  it("forces refreshed thumb and derived fanart when the committed thumb URL changes", async () => {
    const root = await createTempDir();
    const downloadAll = vi.fn().mockResolvedValue({
      thumb: join(root, "output", "ABC-123", "thumb.jpg"),
      downloaded: [join(root, "output", "ABC-123", "thumb.jpg")],
      sceneImages: [],
    });
    const { scraper, config } = createScraperHarness(root, downloadAll);

    await scraper.processFile(
      createEntry(root, createCrawlerData({ thumb_url: "https://example.com/thumb-old.jpg" })),
      config,
      { fileIndex: 1, totalFiles: 1 },
      undefined,
      { crawlerData: createCrawlerData({ thumb_url: "https://example.com/thumb-new.jpg" }) },
    );

    expect(downloadAll.mock.calls[0]?.[4]).toEqual(
      expect.objectContaining({
        forceReplace: expect.objectContaining({ thumb: true, fanart: true }),
      }),
    );
  });

  it("removes a stale local trailer when maintenance explicitly replaces it with no new trailer asset", async () => {
    const root = await createTempDir();
    const oldTrailerPath = join(root, "trailer.mp4");
    await writeFile(oldTrailerPath, "old-trailer", "utf8");
    const { scraper, config } = createScraperHarness(
      root,
      vi.fn().mockResolvedValue({ downloaded: [], sceneImages: [] }),
    );

    const result = await scraper.processFile(
      createEntry(root, createCrawlerData({ trailer_url: "https://example.com/trailer-old.mp4" }), {
        assets: { sceneImages: [], actorPhotos: [], trailer: oldTrailerPath },
      }),
      config,
      { fileIndex: 1, totalFiles: 1 },
      undefined,
      {
        crawlerData: createCrawlerData({ trailer_url: undefined }),
        assetDecisions: { trailer: "replace" },
      },
    );

    expect(result.status).toBe("success");
    expect(result.updatedEntry?.assets.trailer).toBeUndefined();
    await expect(readFile(oldTrailerPath, "utf8")).rejects.toThrow();
  });
});

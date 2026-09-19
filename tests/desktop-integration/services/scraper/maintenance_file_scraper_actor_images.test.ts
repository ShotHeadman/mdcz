import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { getMaintenancePreset as getPreset } from "@mdcz/runtime/maintenance";
import { MaintenanceFileScraper } from "@mdcz/runtime/maintenance/MaintenanceFileScraper";
import { createMemoryPublicationJournal } from "@mdcz/runtime/publication/memoryJournal";
import type { DownloadManager, FileOrganizer, OrganizePlan, TranslateService } from "@mdcz/runtime/scrape";
import { DirectoryInventory } from "@mdcz/runtime/scrape/DirectoryInventory";
import { NfoGenerator } from "@mdcz/runtime/scrape/nfo";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData, LocalScanEntry } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTestOutputPlan } from "../../../helpers/scraper";

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
  ref: { rootId: "test-root", relativePath: "ABC-123.mp4" },
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

const publication = (root: string) => ({
  journal: createMemoryPublicationJournal(),
  commit: vi.fn(),
  operationId: "maintenance-test",
  roots: [{ id: "test-root", hostPath: root }],
  identity: {
    movieId: "movie-1",
    assets: [],
  },
});

const createScraperHarness = (root: string, downloadAll: ReturnType<typeof vi.fn>) => {
  const outputDir = join(root, "output", "ABC-123");
  const plan: OrganizePlan = {
    outputDir,
    metadataDir: outputDir,
    mode: "move",
    renameSubtitles: true,
    targetVideoPath: join(outputDir, "ABC-123.mp4"),
    nfoPath: join(outputDir, "ABC-123.nfo"),
  };
  const config = configurationSchema.parse(defaultConfiguration);
  const scraper = new MaintenanceFileScraper(
    {
      inventory: new DirectoryInventory(),
      aggregationService: { aggregate: vi.fn() } as never,
      translateService: {
        translateCrawlerData: vi.fn(async (data: CrawlerData) => ({ data, error: null })),
      } as unknown as TranslateService,
      nfoGenerator: new NfoGenerator(),
      downloadManager: { downloadAll } as unknown as DownloadManager,
      fileOrganizer: {
        plan: vi.fn().mockReturnValue(plan),
        resolveOutputPlan: vi.fn(resolveTestOutputPlan),
      } as unknown as FileOrganizer,
      signalService: { setProgress: vi.fn(), showLogText: vi.fn() },
      actorImageService: {
        prepareActorProfilesForMovie: vi.fn().mockResolvedValue(undefined),
      } as never,
    },
    getPreset("refresh_metadata"),
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
    await writeFile(join(root, "ABC-123.mp4"), "video");
    await writeFile(join(root, "ABC-123.nfo"), "<movie />");
    const downloadAll = vi.fn<DownloadManager["downloadAll"]>(async (outputDir) => {
      const thumb = join(outputDir, "thumb.jpg");
      await writeFile(thumb, "new-thumb");
      return { thumb, downloaded: [thumb], sceneImages: [] };
    });
    const { scraper, config } = createScraperHarness(root, downloadAll);

    const result = await scraper.processFile(
      createEntry(root, createCrawlerData({ thumb_url: "https://example.com/thumb-old.jpg" })),
      config,
      { fileIndex: 1, totalFiles: 1 },
      undefined,
      { crawlerData: createCrawlerData({ thumb_url: "https://example.com/thumb-new.jpg" }) },
      undefined,
      publication(root),
    );

    expect(downloadAll.mock.calls[0]?.[4]).toEqual(
      expect.objectContaining({
        forceReplace: expect.objectContaining({ thumb: true, fanart: true }),
      }),
    );
    expect(result.status).toBe("success");
    await expect(readFile(join(root, "ABC-123.mp4"), "utf8")).resolves.toBe("video");
  });

  it.each([
    "preserve",
    "replace",
  ] as const)("honors the %s trailer decision when no replacement is produced", async (decision) => {
    const root = await createTempDir();
    const oldTrailerPath = join(root, "trailer.mp4");
    await writeFile(oldTrailerPath, "old-trailer", "utf8");
    await writeFile(join(root, "ABC-123.mp4"), "video", "utf8");
    await writeFile(join(root, "ABC-123.nfo"), "<movie />");
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
        assetDecisions: { trailer: decision },
      },
      undefined,
      publication(root),
    );

    expect(result.status).toBe("success");
    if (decision === "replace") {
      expect(result.updatedEntry?.assets.trailer).toBeUndefined();
    } else {
      expect(result.updatedEntry?.assets.trailer).toBe(oldTrailerPath);
    }
    await expect(readFile(join(root, "ABC-123.mp4"), "utf8")).resolves.toBe("video");
    await expect(readFile(oldTrailerPath, "utf8")).resolves.toBe("old-trailer");
  });
});

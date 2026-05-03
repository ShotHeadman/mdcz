import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { SignalService } from "@main/services/SignalService";
import type { AggregationService } from "@main/services/scraper/aggregation";
import type { DownloadManager } from "@main/services/scraper/DownloadManager";
import { createFileScraper } from "@main/services/scraper/FileScraper";
import type { LocalScanService } from "@main/services/scraper/maintenance/LocalScanService";
import type { NfoGenerator } from "@main/services/scraper/NfoGenerator";
import type { FileOrganizer, OrganizePlan, TranslateService } from "@mdcz/runtime/scrape";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockConfigManager } from "./helpers";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-file-scraper-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const createConfig = (downloadOverrides: Partial<typeof defaultConfiguration.download> = {}) =>
  configurationSchema.parse({
    ...defaultConfiguration,
    download: {
      ...defaultConfiguration.download,
      ...downloadOverrides,
    },
  });

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Sample STRM Title",
  number: "ABC-123",
  actors: [],
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

const createScraper = ({
  config,
  crawlerData,
  plan,
  writeNfo,
  localScanService,
}: {
  config: ReturnType<typeof createConfig>;
  crawlerData: CrawlerData;
  plan: OrganizePlan;
  writeNfo: ReturnType<typeof vi.fn>;
  localScanService?: Pick<LocalScanService, "scanVideo">;
}) => {
  mockConfigManager(config);
  return createFileScraper({
    aggregationService: {
      aggregate: vi.fn().mockResolvedValue(createAggregationResult(crawlerData)),
    } as unknown as AggregationService,
    translateService: {
      translateCrawlerData: vi.fn().mockResolvedValue(crawlerData),
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
      ensureOutputReady: vi.fn().mockResolvedValue(plan),
      organizeVideo: vi.fn().mockResolvedValue(plan.targetVideoPath),
    } as unknown as FileOrganizer,
    signalService: new SignalService(null),
    localScanService,
  });
};

describe("FileScraper .strm support", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map(async (dirPath) => {
        await rm(dirPath, { recursive: true, force: true });
      }),
    );
  });

  it("extracts number from .strm filename and still generates NFO", async () => {
    const config = createConfig({
      generateNfo: true,
    });
    const crawlerData = createCrawlerData({
      durationSeconds: 5400,
      actors: ["Actor A"],
      genres: ["Tag A"],
    });
    const plan: OrganizePlan = {
      outputDir: "/output/ABC-123",
      targetVideoPath: "/output/ABC-123/ABC-123.strm",
      nfoPath: "/output/ABC-123/ABC-123.nfo",
    };
    const writeNfo = vi.fn().mockResolvedValue(plan.nfoPath);
    const scraper = createScraper({ config, crawlerData, plan, writeNfo });

    const result = await scraper.scrapeFile("/tmp/ABC-123.strm", { fileIndex: 1, totalFiles: 1 });

    expect(result.status).toBe("success");
    expect(result.fileInfo.number).toBe("ABC-123");
    expect(result.fileInfo.extension).toBe(".strm");
    expect(writeNfo).toHaveBeenCalledTimes(1);
  });

  it("reuses kept NFO files according to the configured naming mode", async () => {
    for (const scenario of [
      {
        nfoNaming: "filename" as const,
        shouldSyncMovieAlias: false,
      },
      {
        nfoNaming: "both" as const,
        shouldSyncMovieAlias: true,
      },
    ]) {
      const root = await createTempDir();
      const nfoPath = join(root, "ABC-123.nfo");
      const movieNfoPath = join(root, "movie.nfo");
      await writeFile(nfoPath, "<movie><title>Kept Title</title></movie>", "utf8");

      const config = createConfig({
        generateNfo: true,
        keepNfo: true,
        nfoNaming: scenario.nfoNaming,
      });
      const crawlerData = createCrawlerData();
      const plan: OrganizePlan = {
        outputDir: root,
        targetVideoPath: join(root, "ABC-123.strm"),
        nfoPath,
      };
      const writeNfo = vi.fn().mockResolvedValue(nfoPath);
      const scraper = createScraper({ config, crawlerData, plan, writeNfo });

      const result = await scraper.scrapeFile("/tmp/ABC-123.strm", { fileIndex: 1, totalFiles: 1 });

      expect(writeNfo).not.toHaveBeenCalled();
      expect(result.nfoPath).toBe(nfoPath);
      if (scenario.shouldSyncMovieAlias) {
        await expect(readFile(movieNfoPath, "utf8")).resolves.toBe(await readFile(nfoPath, "utf8"));
        continue;
      }
      await expect(readFile(movieNfoPath, "utf8")).rejects.toThrow();
    }
  });

  it("reuses kept NFO local state for planning and uncensored confirmation state", async () => {
    const root = await createTempDir();
    const nfoPath = join(root, "ABC-123-U.nfo");
    await writeFile(nfoPath, "<movie />", "utf8");

    const config = createConfig({
      generateNfo: true,
      keepNfo: true,
    });
    const crawlerData = createCrawlerData();
    const plan: OrganizePlan = {
      outputDir: root,
      targetVideoPath: join(root, "ABC-123-U.strm"),
      nfoPath,
    };
    const writeNfo = vi.fn().mockResolvedValue(nfoPath);
    const fileOrganizer = {
      plan: vi.fn().mockReturnValue(plan),
      ensureOutputReady: vi.fn().mockResolvedValue(plan),
      organizeVideo: vi.fn().mockResolvedValue(plan.targetVideoPath),
    } as unknown as FileOrganizer;
    const scanVideoMock = vi.fn().mockResolvedValue({
      nfoLocalState: {
        uncensoredChoice: "umr",
      },
    });
    const localScanService: Pick<LocalScanService, "scanVideo"> = {
      scanVideo: async () => (await scanVideoMock()) as Awaited<ReturnType<LocalScanService["scanVideo"]>>,
    };
    mockConfigManager(config);
    const scraper = createFileScraper({
      aggregationService: {
        aggregate: vi.fn().mockResolvedValue(createAggregationResult(crawlerData)),
      } as unknown as AggregationService,
      translateService: {
        translateCrawlerData: vi.fn().mockResolvedValue(crawlerData),
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
      fileOrganizer,
      signalService: new SignalService(null),
      localScanService,
    });

    const result = await scraper.scrapeFile(join(root, "ABC-123-U.strm"), { fileIndex: 1, totalFiles: 1 });

    expect(fileOrganizer.plan).toHaveBeenCalledWith(
      expect.objectContaining({
        number: "ABC-123",
      }),
      crawlerData,
      expect.any(Object),
      {
        uncensoredChoice: "umr",
      },
      {
        executionMode: "batch",
      },
    );
    expect(writeNfo).not.toHaveBeenCalled();
    expect(result.uncensoredAmbiguous).toBe(false);
  });

  it("passes preserved local state when regenerating an NFO", async () => {
    const root = await createTempDir();
    const outputDir = join(root, "output");
    const config = createConfig({
      generateNfo: true,
      keepNfo: true,
    });
    const crawlerData = createCrawlerData();
    const plan: OrganizePlan = {
      outputDir,
      targetVideoPath: join(outputDir, "ABC-123.strm"),
      nfoPath: join(outputDir, "ABC-123.nfo"),
    };
    const writeNfo = vi.fn().mockResolvedValue(plan.nfoPath);
    const localScanService: Pick<LocalScanService, "scanVideo"> = {
      scanVideo: vi.fn().mockResolvedValue({
        nfoLocalState: {
          uncensoredChoice: "leak",
          tags: ["保留标签"],
        },
      } as Awaited<ReturnType<LocalScanService["scanVideo"]>>),
    };
    const scraper = createScraper({
      config,
      crawlerData,
      plan,
      writeNfo,
      localScanService,
    });

    await scraper.scrapeFile(join(root, "ABC-123.strm"), { fileIndex: 1, totalFiles: 1 });

    expect(writeNfo).toHaveBeenCalledWith(
      plan.nfoPath,
      crawlerData,
      expect.objectContaining({
        localState: {
          uncensoredChoice: "leak",
          tags: ["保留标签"],
        },
      }),
    );
  });
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { SignalService } from "@main/services/SignalService";
import type { AggregationService } from "@main/services/scraper/aggregation";
import type { DownloadManager } from "@main/services/scraper/DownloadManager";
import type { FileOrganizer, OrganizePlan } from "@main/services/scraper/FileOrganizer";
import { FileScraper } from "@main/services/scraper/FileScraper";
import type { NfoGenerator } from "@main/services/scraper/NfoGenerator";
import type { TranslateService } from "@main/services/scraper/TranslateService";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestConfigManager } from "./helpers";

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
    sample_images: [],
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
}: {
  config: ReturnType<typeof createConfig>;
  crawlerData: CrawlerData;
  plan: OrganizePlan;
  writeNfo: ReturnType<typeof vi.fn>;
}) =>
  new FileScraper({
    configManager: new TestConfigManager(config),
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
  });

describe("FileScraper .strm support", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map(async (dirPath) => {
        await rm(dirPath, { recursive: true, force: true });
      }),
    );
  });

  it("extracts number from .strm filename and still generates NFO", async () => {
    const config = createConfig({
      downloadNfo: true,
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

  it("keeps an existing NFO when keepNfo is enabled", async () => {
    const root = await createTempDir();
    const nfoPath = join(root, "ABC-123.nfo");
    await writeFile(nfoPath, "<movie />", "utf8");

    const config = createConfig({
      downloadNfo: true,
      keepNfo: true,
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
  });
});

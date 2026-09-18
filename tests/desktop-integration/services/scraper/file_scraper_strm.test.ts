import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { createFileScraper } from "@main/services/scraper/FileScraper";
import type {
  AggregationService,
  DownloadManager,
  FileOrganizer,
  NfoGenerator,
  OrganizePlan,
  TranslateService,
} from "@mdcz/runtime/scrape";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  mockConfigManager,
  preparedPublicationFiles,
  prepareFilePublication,
  resolveTestOutputPlan,
} from "../../../helpers/scraper";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-file-scraper-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const createTempFile = async (name: string): Promise<string> => {
  const root = await createTempDir();
  const filePath = join(root, name);
  await writeFile(filePath, "video");
  return filePath;
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
    rejectedSites: [],
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
}) => {
  mockConfigManager(config);
  return createFileScraper({
    aggregationService: {
      aggregate: vi.fn().mockResolvedValue(createAggregationResult(crawlerData)),
    } as unknown as AggregationService,
    translateService: {
      translateCrawlerData: vi.fn().mockResolvedValue({ data: crawlerData, error: null }),
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
      resolveOutputPlan: vi.fn(resolveTestOutputPlan),
    } as unknown as FileOrganizer,
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
      metadataDir: "/output/ABC-123",
      mode: "move",
      renameSubtitles: true,
      targetVideoPath: "/output/ABC-123/ABC-123.strm",
      nfoPath: "/output/ABC-123/ABC-123.nfo",
    };
    const writeNfo = vi.fn().mockResolvedValue(plan.nfoPath);
    const scraper = createScraper({ config, crawlerData, plan, writeNfo });
    const sourcePath = await createTempFile("ABC-123.strm");

    const group = await prepareFilePublication(scraper, sourcePath, { fileIndex: 1, totalFiles: 1 }, undefined, {
      roots: [
        { id: "test-root", hostPath: tmpdir() },
        { id: "output-root", hostPath: "/output" },
      ],
    });
    onTestFinished(async () => await group.release?.());
    const [result] = preparedPublicationFiles(group);

    expect(result.status).toBe("prepared");
    expect(result.fileName).toBe("ABC-123");
    expect(result.crawlerData?.number).toBe("ABC-123");
    expect(writeNfo).toHaveBeenCalledTimes(1);
  });

  it("reuses kept NFO files according to the configured naming mode", async () => {
    const root = await createTempDir();
    const nfoPath = join(root, "ABC-123.nfo");
    const movieNfoPath = join(root, "movie.nfo");
    await writeFile(nfoPath, "<movie><title>Kept Title</title></movie>", "utf8");

    const config = createConfig({ generateNfo: true, keepNfo: true, nfoNaming: "both" });
    const crawlerData = createCrawlerData();
    const plan: OrganizePlan = {
      outputDir: root,
      metadataDir: root,
      mode: "move",
      renameSubtitles: true,
      targetVideoPath: join(root, "ABC-123.strm"),
      nfoPath,
    };
    const writeNfo = vi.fn().mockResolvedValue(nfoPath);
    const scraper = createScraper({ config, crawlerData, plan, writeNfo });
    const sourcePath = await createTempFile("ABC-123.strm");

    const group = await prepareFilePublication(scraper, sourcePath, { fileIndex: 1, totalFiles: 1 }, undefined, {
      roots: [
        { id: "test-root", hostPath: tmpdir() },
        { id: "output-root", hostPath: "/output" },
      ],
    });
    const [result] = preparedPublicationFiles(group);
    onTestFinished(async () => await group.release?.());

    expect(writeNfo).not.toHaveBeenCalled();
    expect(result.nfo).toEqual({
      rootId: "test-root",
      relativePath: relative(tmpdir(), nfoPath).replaceAll("\\", "/"),
    });
    expect(group.publicationPlan?.operations).toContainEqual({
      kind: "write",
      target: {
        rootId: "test-root",
        relativePath: relative(tmpdir(), movieNfoPath).replaceAll("\\", "/"),
      },
      content: { kind: "text", data: await readFile(nfoPath, "utf8") },
      replaceExisting: true,
    });
    await expect(readFile(movieNfoPath)).rejects.toMatchObject({ code: "ENOENT" });
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
      metadataDir: root,
      mode: "move",
      renameSubtitles: true,
      targetVideoPath: join(root, "ABC-123-U.strm"),
      nfoPath,
    };
    const writeNfo = vi.fn().mockResolvedValue(nfoPath);
    const fileOrganizer = {
      plan: vi.fn().mockReturnValue(plan),
      resolveOutputPlan: vi.fn(resolveTestOutputPlan),
    } as unknown as FileOrganizer;
    await writeFile(
      join(root, "ABC-123-U.nfo"),
      "<movie><title>Local title</title><num>ABC-123</num><tag>破解</tag></movie>",
    );
    mockConfigManager(config);
    const scraper = createFileScraper({
      aggregationService: {
        aggregate: vi.fn().mockResolvedValue(createAggregationResult(crawlerData)),
      } as unknown as AggregationService,
      translateService: {
        translateCrawlerData: vi.fn().mockResolvedValue({ data: crawlerData, error: null }),
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
    });
    await writeFile(join(root, "ABC-123-U.strm"), "video");
    const group = await prepareFilePublication(
      scraper,
      join(root, "ABC-123-U.strm"),
      { fileIndex: 1, totalFiles: 1 },
      undefined,
      {
        roots: [
          { id: "test-root", hostPath: tmpdir() },
          { id: "output-root", hostPath: "/output" },
        ],
      },
    );
    onTestFinished(async () => await group.release?.());
    const [result] = preparedPublicationFiles(group);

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
      nfoIgnoreFields: ["director"],
    });
    const crawlerData = createCrawlerData();
    const plan: OrganizePlan = {
      outputDir,
      metadataDir: outputDir,
      mode: "move",
      renameSubtitles: true,
      targetVideoPath: join(outputDir, "ABC-123.strm"),
      nfoPath: join(outputDir, "ABC-123.nfo"),
    };
    const writeNfo = vi.fn().mockResolvedValue(plan.nfoPath);
    await writeFile(
      join(root, "ABC-123.nfo"),
      "<movie><title>Local title</title><num>ABC-123</num><tag>流出</tag><tag>保留标签</tag></movie>",
    );
    const scraper = createScraper({
      config,
      crawlerData,
      plan,
      writeNfo,
    });
    await writeFile(join(root, "ABC-123.strm"), "video");
    const group = await prepareFilePublication(
      scraper,
      join(root, "ABC-123.strm"),
      { fileIndex: 1, totalFiles: 1 },
      undefined,
      {
        roots: [
          { id: "test-root", hostPath: tmpdir() },
          { id: "output-root", hostPath: "/output" },
        ],
      },
    );
    onTestFinished(async () => await group.release?.());

    expect(writeNfo).toHaveBeenCalledWith(
      plan.nfoPath,
      crawlerData,
      expect.objectContaining({
        localState: {
          uncensoredChoice: "leak",
          tags: ["保留标签"],
        },
        enabledFields: expect.not.arrayContaining(["director"]),
      }),
    );
  });
});

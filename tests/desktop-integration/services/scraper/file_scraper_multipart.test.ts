import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { createFileScraper } from "@main/services/scraper/FileScraper";
import { commitPublishedMedia } from "@mdcz/runtime/publication";
import { createMemoryPublicationJournal } from "@mdcz/runtime/publication/memoryJournal";
import type {
  AggregationService,
  DownloadManager,
  FileOrganizer,
  NfoGenerator,
  OrganizePlan,
  RuntimeScrapeSignalService,
  TranslateService,
} from "@mdcz/runtime/scrape";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData, FileInfo } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockConfigManager, prepareAndExecuteFile } from "../../../helpers/scraper";

const config = configurationSchema.parse({
  ...defaultConfiguration,
  download: {
    ...defaultConfiguration.download,
    generateNfo: false,
  },
});

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Sample Title",
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

const createPlan = (fileInfo: FileInfo): OrganizePlan => ({
  outputDir: `/output/${fileInfo.number}`,
  targetVideoPath: `/output/${fileInfo.number}/${fileInfo.fileName}${fileInfo.extension}`,
  nfoPath: `/output/${fileInfo.number}/${fileInfo.number}.nfo`,
});

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-file-scraper-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const createTempFiles = async (...names: string[]): Promise<string[]> => {
  const root = await createTempDir();
  const paths = names.map((name) => join(root, name));
  await Promise.all(paths.map(async (filePath) => await writeFile(filePath, "video")));
  return paths;
};

const createScraper = (
  aggregate: ReturnType<typeof vi.fn>,
  overrides: {
    downloadAll?: ReturnType<typeof vi.fn>;
    resolveOutputPlan?: ReturnType<typeof vi.fn>;
    moveToFailedFolder?: ReturnType<typeof vi.fn>;
    signalService?: RuntimeScrapeSignalService;
    plan?: ReturnType<typeof vi.fn>;
  } = {},
) => {
  mockConfigManager(config);
  const downloadAll =
    overrides.downloadAll ??
    vi.fn().mockResolvedValue({
      downloaded: [],
      sceneImages: [],
    });
  const resolveOutputPlan = overrides.resolveOutputPlan ?? vi.fn(async (plan: OrganizePlan) => plan);
  const moveToFailedFolder = overrides.moveToFailedFolder ?? vi.fn(async (fileInfo: FileInfo) => fileInfo.filePath);
  const defaultSignalService: RuntimeScrapeSignalService = {
    showLogText: vi.fn(),
    setProgress: vi.fn(),
    showScrapeInfo: vi.fn(),
    showScrapeResult: vi.fn(),
    showFailedInfo: vi.fn(),
  };
  const signalService = overrides.signalService ?? defaultSignalService;
  const scraper = createFileScraper({
    aggregationService: {
      aggregate,
    } as unknown as AggregationService,
    translateService: {
      translateCrawlerData: vi.fn(async (data: CrawlerData) => ({ data, error: null })),
    } as unknown as TranslateService,
    nfoGenerator: {
      writeNfo: vi.fn(),
    } as unknown as NfoGenerator,
    downloadManager: {
      downloadAll,
    } as unknown as DownloadManager,
    fileOrganizer: {
      plan: overrides.plan ?? vi.fn((fileInfo: FileInfo) => createPlan(fileInfo)),
      resolveOutputPlan,
      moveToFailedFolder,
    } as unknown as FileOrganizer,
    signalService,
  });

  return {
    scraper,
    mocks: {
      downloadAll,
      resolveOutputPlan,
      signalService,
      moveToFailedFolder,
    },
  };
};

describe("FileScraper multipart aggregation cache", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
    );
  });

  it("shares aggregation and publication across multipart files while retaining individual failures", async () => {
    const aggregate = vi.fn().mockResolvedValue(createAggregationResult(createCrawlerData({ number: "FC2-123456" })));
    const { scraper, mocks } = createScraper(aggregate);
    const paths = await createTempFiles("FC2-123456-1.mp4", "FC2-123456-2.mp4", "FC2-123456-3.mp4");
    const entries = await Promise.all(
      paths.map(async (filePath, index) => {
        const progress = { fileIndex: index + 1, totalFiles: paths.length };
        const result = await scraper.prepareFile(filePath, progress, undefined, {
          roots: [
            { id: "test-root", hostPath: tmpdir() },
            { id: "output-root", hostPath: "/output" },
          ],
        });
        if (result.status !== "prepared") throw new Error("Expected prepared file");
        return { prepared: result.prepared, progress };
      }),
    );
    await rm(paths[2]);
    const [part1, part2, part3] = await scraper.executePreparedFiles(entries);

    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(mocks.downloadAll).toHaveBeenCalledOnce();
    expect(part3.status).toBe("failed");
    expect(part1.status).toBe("success");
    expect(part2.status).toBe("success");
    expect(part1.part?.number).toBe(1);
    expect(part2.part?.number).toBe(2);
    expect(part1.relativePath).toContain("FC2-123456-1");
    expect(part2.relativePath).toContain("FC2-123456-2");
    if (part1.status !== "success" || part2.status !== "success") throw new Error("Expected successful parts");
    expect(part1.publicationPlan).toBe(part2.publicationPlan);
    expect(part1.publicationPlan.media).toHaveLength(2);
    await part1.release?.();
  });

  it("reuses one aggregation request for alphabetic multipart files", async () => {
    const aggregate = vi.fn().mockResolvedValue(createAggregationResult(createCrawlerData({ number: "IDBD-905" })));
    const { scraper } = createScraper(aggregate);
    const [partAPath, partHPath] = await createTempFiles("IDBD-905-A.mp4", "IDBD-905-H.mp4");

    const [partA, partH] = await Promise.all([
      prepareAndExecuteFile(scraper, partAPath, { fileIndex: 1, totalFiles: 2 }, undefined, {
        roots: [
          { id: "test-root", hostPath: tmpdir() },
          { id: "output-root", hostPath: "/output" },
        ],
      }),
      prepareAndExecuteFile(scraper, partHPath, { fileIndex: 2, totalFiles: 2 }, undefined, {
        roots: [
          { id: "test-root", hostPath: tmpdir() },
          { id: "output-root", hostPath: "/output" },
        ],
      }),
    ]);

    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(partA.status).toBe("success");
    expect(partH.status).toBe("success");
    expect(partA.part?.number).toBe(1);
    expect(partH.part?.number).toBe(8);
    expect(partA.relativePath).toContain("IDBD-905-A");
    expect(partH.relativePath).toContain("IDBD-905-H");
  });

  it("keeps aggregation requests separate for different numbers", async () => {
    const aggregate = vi
      .fn()
      .mockResolvedValueOnce(createAggregationResult(createCrawlerData({ number: "ABC-123" })))
      .mockResolvedValueOnce(createAggregationResult(createCrawlerData({ number: "XYZ-999" })));
    const { scraper } = createScraper(aggregate);
    const [firstPath, secondPath] = await createTempFiles("ABC-123-1.mp4", "XYZ-999-1.mp4");

    const [first, second] = await Promise.all([
      prepareAndExecuteFile(scraper, firstPath, { fileIndex: 1, totalFiles: 2 }, undefined, {
        roots: [
          { id: "test-root", hostPath: tmpdir() },
          { id: "output-root", hostPath: "/output" },
        ],
      }),
      prepareAndExecuteFile(scraper, secondPath, { fileIndex: 2, totalFiles: 2 }, undefined, {
        roots: [
          { id: "test-root", hostPath: tmpdir() },
          { id: "output-root", hostPath: "/output" },
        ],
      }),
    ]);

    expect(aggregate).toHaveBeenCalledTimes(2);
    expect(first.status).toBe("success");
    expect(second.status).toBe("success");
  });

  it("propagates shared aggregation failures to each multipart result", async () => {
    const aggregate = vi.fn().mockRejectedValue(new Error("aggregate failed"));
    const { scraper } = createScraper(aggregate);
    const [part1Path, part2Path] = await createTempFiles("FC2-123456-1.mp4", "FC2-123456-2.mp4");

    const [part1, part2] = await Promise.all([
      prepareAndExecuteFile(scraper, part1Path, { fileIndex: 1, totalFiles: 2 }, undefined, {
        roots: [
          { id: "test-root", hostPath: tmpdir() },
          { id: "output-root", hostPath: "/output" },
        ],
      }),
      prepareAndExecuteFile(scraper, part2Path, { fileIndex: 2, totalFiles: 2 }, undefined, {
        roots: [
          { id: "test-root", hostPath: tmpdir() },
          { id: "output-root", hostPath: "/output" },
        ],
      }),
    ]);

    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(part1).toMatchObject({
      status: "failed",
      error: "aggregate failed",
    });
    expect(part2).toMatchObject({
      status: "failed",
      error: "aggregate failed",
    });
  });

  it("prepares same-number multipart files independently while sharing aggregation", async () => {
    const aggregate = vi.fn().mockResolvedValue(createAggregationResult(createCrawlerData({ number: "FC2-123456" })));
    let markFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    let releaseFirst: (() => void) | undefined;
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const resolveOutputPlan = vi.fn(async (plan: OrganizePlan) => {
      if (resolveOutputPlan.mock.calls.length === 1) {
        markFirstStarted?.();
        await holdFirst;
      }
      return plan;
    });
    const [part1Path, part2Path] = await createTempFiles("FC2-123456-1.mp4", "FC2-123456-2.mp4");
    const { scraper } = createScraper(aggregate, { resolveOutputPlan });

    const firstPromise = scraper.prepareFile(part1Path, { fileIndex: 1, totalFiles: 2 }, undefined, {
      roots: [
        { id: "test-root", hostPath: tmpdir() },
        { id: "output-root", hostPath: "/output" },
      ],
    });
    await firstStarted;

    const secondPromise = scraper.prepareFile(part2Path, { fileIndex: 2, totalFiles: 2 }, undefined, {
      roots: [
        { id: "test-root", hostPath: tmpdir() },
        { id: "output-root", hostPath: "/output" },
      ],
    });
    try {
      const second = await secondPromise;
      expect(second.status).toBe("prepared");
      expect(resolveOutputPlan).toHaveBeenCalledTimes(2);
      expect(aggregate).toHaveBeenCalledTimes(1);
    } finally {
      releaseFirst?.();
      await firstPromise;
    }

    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first.status).toBe("prepared");
    expect(second.status).toBe("prepared");
    expect(resolveOutputPlan).toHaveBeenCalledTimes(2);
  });

  it("publishes each multipart video and consumes one number-level feature exactly once", async () => {
    const root = await createTempDir();
    const output = join(root, "output", "FC2-123456");
    const names = ["FC2-123456-CD1.mp4", "FC2-123456-CD2.mp4", "FC2-123456-CD3.mp4"];
    const paths = names.map((name) => join(root, name));
    const featurePath = join(root, "FC2-123456-花絮.mp4");
    await Promise.all([...paths.map((filePath) => writeFile(filePath, filePath)), writeFile(featurePath, "feature")]);
    const aggregate = vi.fn().mockResolvedValue(createAggregationResult(createCrawlerData({ number: "FC2-123456" })));
    const plan = vi.fn(
      (fileInfo: FileInfo): OrganizePlan => ({
        outputDir: output,
        targetVideoPath: join(output, `${fileInfo.fileName}${fileInfo.extension}`),
        nfoPath: join(output, "FC2-123456.nfo"),
      }),
    );
    const { scraper } = createScraper(aggregate, { plan });
    const mediaRoot = { id: "root", hostPath: root };
    const journal = createMemoryPublicationJournal();

    for (const [index, filePath] of paths.entries()) {
      const result = await prepareAndExecuteFile(
        scraper,
        filePath,
        { fileIndex: index + 1, totalFiles: paths.length },
        undefined,
        {
          roots: [mediaRoot],
        },
      );
      expect(result.status).toBe("success");
      if (result.status !== "success") continue;
      await commitPublishedMedia(result.publicationPlan, {
        resolveRoot: async () => mediaRoot,
        journal,
        commit: () => undefined,
      });
    }

    for (const name of names) await expect(access(join(output, name))).resolves.toBeUndefined();
    await expect(readFile(join(output, "FC2-123456-花絮.mp4"), "utf8")).resolves.toBe("feature");
    await expect(access(featurePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("emits a processing result before the terminal result", async () => {
    const aggregate = vi.fn().mockResolvedValue(createAggregationResult(createCrawlerData({ number: "ABC-123" })));
    const results: string[] = [];
    const signalService: RuntimeScrapeSignalService = {
      showLogText: vi.fn(),
      setProgress: vi.fn(),
      showScrapeInfo: vi.fn(),
      showScrapeResult: (result) => {
        results.push(result.status);
      },
      showFailedInfo: vi.fn(),
    };
    const { scraper } = createScraper(aggregate, { signalService });
    const [sourcePath] = await createTempFiles("ABC-123.mp4");

    const terminal = await prepareAndExecuteFile(scraper, sourcePath, undefined, undefined, {
      roots: [
        { id: "test-root", hostPath: tmpdir() },
        { id: "output-root", hostPath: "/output" },
      ],
    });

    expect(terminal.status).toBe("success");
    expect(results[0]).toBe("processing");
    expect(results.at(-1)).toBe("success");
  });
  it("reports failed results without moving the source during scrape", async () => {
    const root = await createTempDir();
    const sourcePath = join(root, "FC2-123456.mp4");
    await writeFile(sourcePath, "video", "utf8");

    const aggregate = vi.fn().mockResolvedValue(null);
    const { scraper } = createScraper(aggregate);

    const result = await prepareAndExecuteFile(scraper, sourcePath, { fileIndex: 1, totalFiles: 1 }, undefined, {
      roots: [
        { id: "test-root", hostPath: tmpdir() },
        { id: "output-root", hostPath: "/output" },
      ],
    });

    expect(result).toMatchObject({
      status: "failed",
      relativePath: sourcePath,
    });
  });
});

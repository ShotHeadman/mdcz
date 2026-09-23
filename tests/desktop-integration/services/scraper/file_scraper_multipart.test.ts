import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { LibraryRepository, ScrapeRunRepository } from "@mdcz/persistence";
import { toCommittedMovie, writeCommittedMovie } from "@mdcz/runtime/publication/committedMovie";
import { MoveOutput } from "@mdcz/runtime/publication/MoveOutput";
import {
  type PreparedMovieOutput,
  prepareMovieArtifacts,
  retainedRegisteredFeatures,
} from "@mdcz/runtime/publication/movieArtifacts";
import { WriteOutput } from "@mdcz/runtime/publication/WriteOutput";
import {
  type AggregationService,
  type DownloadManager,
  FileOrganizer,
  type NfoGenerator,
  type OrganizePlan,
  type RuntimeScrapeSignalService,
  type TranslateService,
} from "@mdcz/runtime/scrape";
import { DirectoryInventory } from "@mdcz/runtime/scrape/DirectoryInventory";
import { Website } from "@mdcz/shared/enums";
import { buildFileId } from "@mdcz/shared/mediaIdentity";
import type { CrawlerData, FileInfo } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { mediaRoots } from "../../../../packages/persistence/src/schema";
import { createTestPersistenceDatabase } from "../../../../packages/persistence/src/testDatabase";
import { collectObservableTrace } from "../../../helpers/observableTrace";
import {
  createFileScraper,
  mockConfigManager,
  preparedPublicationFiles,
  prepareFilePublication,
} from "../../../helpers/scraper";

const installTestOutput = async (input: { output: PreparedMovieOutput; library: LibraryRepository }) => {
  const { output, library } = input;
  if (!output.scrape) throw new Error("Scrape output requires movie metadata");
  const committedMovie = toCommittedMovie(output, output.scrape);
  const commit = () => {
    writeCommittedMovie(library, committedMovie);
  };

  if (output.moves.length) {
    await new MoveOutput().install({
      moves: output.moves,
      artifacts: output.artifacts,
      protectedMediaFiles: output.protectedMediaFiles,
      commit,
    });
  } else {
    await new WriteOutput().install(output.artifacts, {
      protectedMediaFiles: output.protectedMediaFiles,
      commit,
    });
  }

  return committedMovie;
};

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("node:fs/promises") & { default: typeof import("node:fs/promises") }
  >();
  return {
    ...original,
    ...Object.fromEntries(
      Object.keys(original.default).map((key) => [
        key,
        (...args: unknown[]) => Reflect.apply(Reflect.get(original.default, key), original.default, args),
      ]),
    ),
  };
});

const config = configurationSchema.parse({
  ...defaultConfiguration,
  download: {
    ...defaultConfiguration.download,
    generateNfo: false,
    tagBadges: false,
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
  outputDir: join(parse(fileInfo.filePath).dir, "output", fileInfo.number),
  metadataDir: join(parse(fileInfo.filePath).dir, "output", fileInfo.number),
  mode: "move",
  renameSubtitles: true,
  targetVideoPath: join(
    parse(fileInfo.filePath).dir,
    "output",
    fileInfo.number,
    `${fileInfo.fileName}${fileInfo.extension}`,
  ),
  nfoPath: join(parse(fileInfo.filePath).dir, "output", fileInfo.number, `${fileInfo.number}.nfo`),
});

const tempDirs: string[] = [];
const databases: ReturnType<typeof createTestPersistenceDatabase>[] = [];

const createPublicationContext = async (root: string, names: string[]) => {
  const database = createTestPersistenceDatabase();
  databases.push(database);
  const mediaRoot = { id: "root", hostPath: root };
  database.db
    .insert(mediaRoots)
    .values({ ...mediaRoot, displayName: "root", createdAt: new Date(), updatedAt: new Date() })
    .run();
  const library = new LibraryRepository(database);
  const scrapeRuns = new ScrapeRunRepository(database);
  const run = await scrapeRuns.create({
    rootId: "root",
    outputRootId: "root",
    executionMode: "batch",
    items: names.map((relativePath, ordinal) => ({
      id: buildFileId(join(root, relativePath)),
      rootId: "root",
      relativePath,
      ordinal,
    })),
  });
  return {
    database,
    library,
    scrapeRuns,
    runId: run.id,
    mediaRoot,
    resolveRoot: async () => mediaRoot,
  };
};

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
  const organizer = new FileOrganizer();
  const resolveOutputPlan =
    overrides.resolveOutputPlan ??
    vi.fn(async (plan: OrganizePlan, sourcePath: string, options: Parameters<FileOrganizer["resolveOutputPlan"]>[2]) =>
      organizer.resolveOutputPlan(plan, sourcePath, options),
    );
  const moveToFailedFolder = overrides.moveToFailedFolder ?? vi.fn(async (fileInfo: FileInfo) => fileInfo.filePath);
  const defaultSignalService: RuntimeScrapeSignalService = {
    showLogText: vi.fn(),
    setProgress: vi.fn(),
    showScrapeInfo: vi.fn(),
    showFailedInfo: vi.fn(),
  };
  const signalService = overrides.signalService ?? defaultSignalService;
  const translateCrawlerData = vi.fn(async (data: CrawlerData) => ({ data, error: null }));
  const scraper = createFileScraper({
    aggregationService: {
      aggregate,
    } as unknown as AggregationService,
    translateService: {
      translateCrawlerData,
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
      translateCrawlerData,
      downloadAll,
      resolveOutputPlan,
      signalService,
      moveToFailedFolder,
    },
  };
};

describe("FileScraper movie groups", () => {
  it.each(
    [false, true].flatMap((move) =>
      [false, true].flatMap((crossDevice) => [1, 2].map((parts) => ({ move, crossDevice, parts }))),
    ),
  )("preserves desktop output contracts: move=$move crossDevice=$crossDevice parts=$parts", async ({
    move,
    crossDevice,
    parts,
  }) => {
    const root = await createTempDir();
    const names = parts === 1 ? ["FC2-123456.mp4"] : ["FC2-123456-CD1.mp4", "FC2-123456-CD2.mp4"];
    for (const name of names) await writeFile(join(root, name), name);
    const context = await createPublicationContext(root, names);
    const aggregate = vi.fn().mockResolvedValue(createAggregationResult(createCrawlerData({ number: "FC2-123456" })));
    const output = join(root, "output");
    const { scraper, mocks } = createScraper(aggregate, {
      plan: vi.fn(
        (file: FileInfo): OrganizePlan => ({
          outputDir: output,
          metadataDir: output,
          mode: move ? "move" : "preserve",
          renameSubtitles: false,
          targetVideoPath: move ? join(output, `${file.fileName}${file.extension}`) : file.filePath,
          nfoPath: join(output, "FC2-123456.nfo"),
        }),
      ),
    });
    const trace = collectObservableTrace(context.database.sqlite, { media: root }, crossDevice);
    let observed: ReturnType<typeof trace.stop>;
    try {
      const inputs = names.map((name, index) => ({
        filePath: join(root, name),
        progress: { fileIndex: index + 1, totalFiles: parts },
        options: {
          roots: [context.mediaRoot],
          source: { rootId: "root", relativePath: name },
        },
      }));
      const preparation = await scraper.prepareGroup(inputs);
      if (preparation.status !== "prepared") throw new Error("Expected prepared desktop member");
      const group = await scraper.executePreparedFiles(preparation.prepared);
      try {
        if (!group.output) throw new Error("Expected desktop publication");
        const committedMovie = await installTestOutput({
          output: group.output,
          library: context.library,
        });
        expect(committedMovie.files).toHaveLength(parts);
      } finally {
        await group.release?.();
      }
    } finally {
      observed = trace.stop();
    }
    expect(aggregate).toHaveBeenCalledOnce();
    expect(mocks.translateCrawlerData).toHaveBeenCalledOnce();
    const movies = await context.library.listEntries();
    expect(movies).toHaveLength(1);
    expect(movies[0].files).toHaveLength(parts);
    for (const name of names) {
      expect(await readFile(join(move ? output : root, name), "utf8")).toBe(name);
      if (move) await expect(access(join(root, name))).rejects.toMatchObject({ code: "ENOENT" });
    }
    if (move && crossDevice) expect(observed.counts["filesystem-result.rename"]).toBe(parts);
    if (process.env.MDCZ_CAPTURE_BASELINE) {
      const fs = await import("node:fs/promises");
      await fs.mkdir(process.env.MDCZ_CAPTURE_BASELINE, { recursive: true });
      await fs.writeFile(
        join(
          process.env.MDCZ_CAPTURE_BASELINE,
          `desktop-${move ? "move" : "write"}-${crossDevice ? "cross" : "same"}-${parts}.json`,
        ),
        `${JSON.stringify({ scenario: { host: "desktop-adapter", move, crossDevice, parts, aggregation: "stub", downloads: "stub" }, ...observed }, null, 2)}\n`,
      );
    }
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const database of databases.splice(0)) database.close();
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
    );
  });

  it.each([
    "source",
    "subtitle",
  ])("does not partially publish a movie when a participant disappears (%s)", async (missing) => {
    const root = await createTempDir();
    const output = join(root, "output", "FC2-123456");
    const names = ["FC2-123456-CD1.strm", "FC2-123456-CD2.mp4", "FC2-123456-CD3.mp4"];
    const paths = names.map((name) => join(root, name));
    const strmContent = "./media/movie.mp4\n";
    const subtitleNames = names.map((name) => `${parse(name).name}.zh.srt`);
    await Promise.all([
      ...paths.map((path, index) => writeFile(path, index ? names[index] : strmContent)),
      ...subtitleNames.map((name) => writeFile(join(root, name), name)),
      writeFile(join(root, "FC2-123456-花絮.mp4"), "feature"),
    ]);
    const context = await createPublicationContext(root, names);
    const aggregate = vi
      .fn()
      .mockResolvedValue(
        createAggregationResult(
          createCrawlerData({ number: "FC2-123456", poster_url: "https://example.test/poster.jpg" }),
        ),
      );
    const { scraper, mocks } = createScraper(aggregate, {
      plan: vi.fn(
        (fileInfo: FileInfo): OrganizePlan => ({
          mode: "move",
          renameSubtitles: true,
          outputDir: output,
          metadataDir: output,
          targetVideoPath: join(output, `${fileInfo.fileName}${fileInfo.extension}`),
          nfoPath: join(output, "FC2-123456.nfo"),
        }),
      ),
      downloadAll: vi.fn(async (stagingDir: string) => {
        const poster = join(stagingDir, "poster.jpg");
        await writeFile(poster, "poster");
        return { downloaded: [poster], sceneImages: [], poster };
      }),
    });
    const inputs = paths.map((filePath, index) => ({
      filePath,
      progress: { fileIndex: index + 1, totalFiles: paths.length },
      options: {
        roots: [context.mediaRoot],
        source: { rootId: "root", relativePath: names[index] },
      },
    }));
    const preparation = await scraper.prepareGroup(inputs);
    if (preparation.status !== "prepared") throw new Error("Expected prepared file");
    const failedIndex = missing === "source" ? 2 : 0;
    await rm(missing === "source" ? paths[failedIndex] : join(root, subtitleNames[failedIndex]));
    const group = await scraper.executePreparedFiles(preparation.prepared);
    onTestFinished(async () => await group.release?.());
    expect(aggregate).toHaveBeenCalledTimes(1);
    if (missing === "source") {
      expect(group.output).toBeDefined();
      if (!group.output) throw new Error("Expected output");
      await expect(
        installTestOutput({
          output: group.output,
          library: context.library,
        }),
      ).rejects.toThrow();
      expect(await context.library.listEntries()).toEqual([]);
      expect(await readFile(join(root, "FC2-123456-花絮.mp4"), "utf8")).toBe("feature");
      return;
    }
    expect(group.output).toBeUndefined();
    expect(group.results).toHaveLength(names.length);
    const committed = [...group.results].sort((a, b) => (a.part?.number ?? 0) - (b.part?.number ?? 0));
    await group.release?.();
    expect(await context.library.listEntries()).toEqual([]);
    for (const [index, result] of committed.entries()) {
      expect(result.status).toBe("failed");
      expect(result.part?.number).toBe(index + 1);
      expect(result).not.toHaveProperty("output");
      expect(result).not.toHaveProperty("release");
      await expect(access(join(output, names[index]))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(paths[index], "utf8")).toBe(index ? names[index] : strmContent);
    }
    expect(await readFile(join(root, "FC2-123456-花絮.mp4"), "utf8")).toBe("feature");
    await expect(access(mocks.downloadAll.mock.calls[0][0])).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps aggregation requests separate for different numbers", async () => {
    const aggregate = vi
      .fn()
      .mockResolvedValueOnce(createAggregationResult(createCrawlerData({ number: "ABC-123" })))
      .mockResolvedValueOnce(createAggregationResult(createCrawlerData({ number: "XYZ-999" })));
    const { scraper } = createScraper(aggregate);
    const [firstPath, secondPath] = await createTempFiles("ABC-123-1.mp4", "XYZ-999-1.mp4");

    const groups = await Promise.all([
      prepareFilePublication(scraper, firstPath, { fileIndex: 1, totalFiles: 2 }, undefined, {
        roots: [
          { id: "test-root", hostPath: tmpdir() },
          { id: "output-root", hostPath: "/output" },
        ],
      }),
      prepareFilePublication(scraper, secondPath, { fileIndex: 2, totalFiles: 2 }, undefined, {
        roots: [
          { id: "test-root", hostPath: tmpdir() },
          { id: "output-root", hostPath: "/output" },
        ],
      }),
    ]);
    onTestFinished(async () => {
      for (const group of groups) await group.release?.();
    });
    const [first, second] = groups.map((group) => preparedPublicationFiles(group)[0]);

    expect(aggregate).toHaveBeenCalledTimes(2);
    expect(first.status).toBe("prepared");
    expect(second.status).toBe("prepared");
  });

  it("propagates shared aggregation failures to each multipart result", async () => {
    const aggregate = vi.fn().mockRejectedValue(new Error("aggregate failed"));
    const { scraper } = createScraper(aggregate);
    const [part1Path, part2Path] = await createTempFiles("FC2-123456-1.mp4", "FC2-123456-2.mp4");

    const preparation = await scraper.prepareGroup(
      [part1Path, part2Path].map((filePath) => ({
        filePath,
        options: {
          roots: [
            { id: "test-root", hostPath: tmpdir() },
            { id: "output-root", hostPath: "/output" },
          ],
        },
      })),
    );

    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(preparation).toMatchObject({
      status: "failed",
      error: "aggregate failed",
    });
  });

  it("retains one movie feature across multipart publication and metadata refresh without adopting a new copy", async () => {
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
        metadataDir: output,
        mode: "move",
        renameSubtitles: true,
        targetVideoPath: join(output, `${fileInfo.fileName}${fileInfo.extension}`),
        nfoPath: join(output, "FC2-123456.nfo"),
      }),
    );
    const context = await createPublicationContext(root, names);
    const { scraper } = createScraper(aggregate, { plan });
    const trace = collectObservableTrace(context.database.sqlite, { media: root });
    onTestFinished(() => {
      trace.stop();
    });
    const inputs = paths.map((filePath, index) => ({
      filePath,
      progress: { fileIndex: index + 1, totalFiles: paths.length },
      options: {
        roots: [context.mediaRoot],
        source: { rootId: "root", relativePath: names[index] },
      },
    }));
    const preparation = await scraper.prepareGroup(inputs);
    if (preparation.status !== "prepared") throw new Error("Expected prepared movie file");
    const group = await scraper.executePreparedFiles(preparation.prepared);
    onTestFinished(async () => await group.release?.());
    if (!group.output) throw new Error("Expected movie publication plan");
    const featureMoves = group.output.moves.filter((move) => move.source.relativePath.endsWith("花絮.mp4"));
    expect(featureMoves).toHaveLength(1);
    try {
      await installTestOutput({
        output: group.output,
        library: context.library,
      });
    } finally {
      await group.release?.();
    }
    const observed = trace.stop();
    if (process.env.MDCZ_CAPTURE_BASELINE) {
      const fs = await import("node:fs/promises");
      await fs.mkdir(process.env.MDCZ_CAPTURE_BASELINE, { recursive: true });
      await fs.writeFile(
        join(process.env.MDCZ_CAPTURE_BASELINE, "desktop-move-same-3-feature.json"),
        `${JSON.stringify({ scenario: { host: "desktop-adapter", move: true, crossDevice: false, parts: 3, aggregation: "stub", downloads: "stub" }, ...observed }, null, 2)}\n`,
      );
    }
    let movie = await context.library.getEntryById(group.output.movieId);
    expect(movie.files).toHaveLength(names.length);
    expect(movie.assets).toEqual([
      expect.objectContaining({
        kind: "feature",
        fileId: null,
        relativePath: "output/FC2-123456/FC2-123456-花絮.mp4",
        published: true,
      }),
    ]);
    for (const name of names) await expect(access(join(output, name))).resolves.toBeUndefined();
    await expect(readFile(join(output, "FC2-123456-花絮.mp4"), "utf8")).resolves.toBe("feature");
    await expect(access(featurePath)).rejects.toMatchObject({ code: "ENOENT" });

    const versionName = "FC2-123456-4K.mp4";
    const versionPath = join(root, versionName);
    await writeFile(versionPath, versionPath);
    const versionRun = await context.scrapeRuns.create({
      rootId: "root",
      outputRootId: "root",
      executionMode: "batch",
      items: [{ id: buildFileId(versionPath), rootId: "root", relativePath: versionName, ordinal: 0 }],
    });
    const versionItem = versionRun.items[0];
    const version = await prepareFilePublication(scraper, versionPath, undefined, undefined, {
      roots: [context.mediaRoot],
      source: { rootId: "root", relativePath: versionName },
      operationId: versionItem.id,
    });
    onTestFinished(async () => await version.release?.());
    if (!version.output) throw new Error("Expected version publication plan");
    const versionMovie = await installTestOutput({
      output: version.output,
      library: context.library,
    });
    await version.release?.();
    expect(versionMovie.assets).toEqual([]);
    const previousFiles = movie.files.map((file) => file.id);
    movie = await context.library.getEntryById(movie.id);
    expect(movie.files).toHaveLength(names.length);
    expect(movie.files.map((file) => file.id)).toEqual(previousFiles);
    expect(movie.assets).toEqual([expect.objectContaining({ fileId: null, kind: "feature", published: true })]);
    expect(await context.library.listEntries()).toHaveLength(2);

    const metadata = join(root, "metadata", "FC2-123456");
    const refreshFiles = movie.files.map((file) => ({
      fileId: file.id,
      sourceAbsolutePath: join(root, file.rootRelativePath),
    }));
    const members = refreshFiles.map((file) => {
      const member = movie.files.find((candidate) => candidate.id === file.fileId);
      if (!member) throw new Error(`Missing publication member: ${file.fileId}`);
      const fileId = member.id;
      const source = { rootId: member.rootId, relativePath: member.rootRelativePath };
      return {
        source,
        fileId,
        assetLayout: { staged: new Map(), retained: new Map() },
        layout: {
          mode: "preserve" as const,
          sourceVideoPath: file.sourceAbsolutePath,
          targetVideoPath: file.sourceAbsolutePath,
          outputDir: output,
          metadataDir: metadata,
          existingMetadataDir: output,
          nfoPath: join(metadata, "FC2-123456.nfo"),
          sidecars: [],
        },
      };
    });
    const refresh = await prepareMovieArtifacts({
      inventory: new DirectoryInventory(),
      roots: [context.mediaRoot],
      members,
      retainedMovieAssets: retainedRegisteredFeatures(
        members,
        movie.assets.flatMap((asset) =>
          asset.rootId && asset.relativePath
            ? [{ ...asset, rootId: asset.rootId, relativePath: asset.relativePath }]
            : [],
        ),
      ),
      downloadedAssets: { downloaded: [], sceneImages: [] },
      actorPhotoPaths: [],
      nfoNaming: "movie",
      writeNfo: async () => undefined,
    });
    if (!group.output.scrape) throw new Error("Scrape output requires movie metadata");
    const refreshMovie = toCommittedMovie({ ...refresh, movieId: movie.id }, group.output.scrape);
    await new WriteOutput().install(refresh.artifacts, {
      protectedMediaFiles: refresh.protectedMediaFiles,
      commit: () =>
        context.library.writeEntry(
          {
            id: movie.id,
            assets: refreshMovie.assets.filter((asset) => asset.fileId === null),
          },
          refresh.files.map((file) => ({
            fileId: file.fileId,
            rootId: file.target.rootId,
            rootRelativePath: file.target.relativePath,
            size: file.size,
            modifiedAt: file.modifiedAt,
            assets: refreshMovie.assets.filter((asset) => asset.fileId === file.fileId),
          })),
        ),
    });
    const afterRefresh = await context.library.getEntryById(movie.id);
    expect(afterRefresh.assets.filter((asset) => asset.kind === "feature")).toEqual([
      expect.objectContaining({ fileId: null, relativePath: "output/FC2-123456/FC2-123456-花絮.mp4", published: true }),
    ]);
    expect(afterRefresh.files.map((file) => file.id).sort()).toEqual(movie.files.map((file) => file.id).sort());
    for (const name of names) expect(await readFile(join(output, name), "utf8")).toBe(join(root, name));
    expect(await readFile(join(output, "FC2-123456-花絮.mp4"), "utf8")).toBe("feature");

    const stagingDir = join(root, "staging");
    const posterSource = join(stagingDir, "poster.jpg");
    await mkdir(stagingDir);
    await writeFile(posterSource, "shared poster");
    const artwork = await prepareMovieArtifacts({
      inventory: new DirectoryInventory(),
      roots: [context.mediaRoot],
      members: members.map((member, index) => {
        const metadataDir = join(root, "artwork", String(index));
        return {
          ...member,
          layout: { ...member.layout, metadataDir, nfoPath: join(metadataDir, "movie.nfo") },
          assetLayout: { staged: new Map([["poster.jpg", join(metadataDir, "poster.jpg")]]), retained: new Map() },
        };
      }),
      stagingDir,
      downloadedAssets: { poster: posterSource, downloaded: [posterSource], sceneImages: [] },
      actorPhotoPaths: [],
      nfoNaming: "movie",
      writeNfo: async () => undefined,
    });
    await new WriteOutput().install(artwork.artifacts, {
      protectedMediaFiles: artwork.protectedMediaFiles,
      commit: () => undefined,
    });
    for (let index = 0; index < members.length; index++)
      await expect(readFile(join(root, "artwork", String(index), "poster.jpg"), "utf8")).resolves.toBe("shared poster");
    await expect(readFile(posterSource, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports failed results without moving the source during scrape", async () => {
    const root = await createTempDir();
    const sourcePath = join(root, "FC2-123456.mp4");
    await writeFile(sourcePath, "video", "utf8");

    const aggregate = vi.fn().mockResolvedValue(null);
    const { scraper } = createScraper(aggregate);

    const group = await prepareFilePublication(scraper, sourcePath, { fileIndex: 1, totalFiles: 1 }, undefined, {
      roots: [
        { id: "test-root", hostPath: tmpdir() },
        { id: "output-root", hostPath: "/output" },
      ],
    });
    onTestFinished(async () => await group.release?.());
    const [result] = preparedPublicationFiles(group);

    expect(result).toMatchObject({
      status: "failed",
      relativePath: sourcePath,
    });
  });
});

import * as fs from "node:fs/promises";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { commitPublishedMedia, createPublicationPlan, preparePublicationPlan } from "@mdcz/runtime/publication";
import { createMemoryPublicationJournal } from "@mdcz/runtime/publication/memoryJournal";
import { FileOrganizer, type OrganizePlan } from "@mdcz/runtime/scrape";
import * as fileUtils from "@mdcz/runtime/scrape/utils/filesystem";
import { Website } from "@mdcz/shared/enums";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOrganizerConfig as createConfig,
  createOrganizerCrawlerData as createCrawlerData,
  createOrganizerFileInfo as createFileInfo,
} from "../../../unit/services/scraper/file_organizer.testSupport";

const tempDirs: string[] = [];
const publicationFs = { ...fs };

const publishVideo = async (
  fileInfo: ReturnType<typeof createFileInfo>,
  plan: OrganizePlan,
  config: ReturnType<typeof createConfig>,
  _sourceRoot: string,
): Promise<string> => {
  const { plan: prepared } = await preparePublicationPlan({
    files: [{ sourceVideoPath: fileInfo.filePath, outputVideoPath: plan.targetVideoPath, organizePlan: plan }],
    existingAssetDir: dirname(fileInfo.filePath),
    metadataOutputDir: plan.metadataDir ?? plan.outputDir,
    downloadedAssets: { downloaded: [], sceneImages: [] },
    actorPhotoPaths: [],
    renameSubtitles: config.behavior.successFileRename,
    strmPathMappings: config.paths.strmPathMappings,
    nfoNaming: config.download.nfoNaming,
    writeNfo: async () => undefined,
  });
  const roots = tempDirs.map((hostPath) => ({ id: hostPath, hostPath }));
  await commitPublishedMedia(createPublicationPlan("organize", "scrape", prepared, roots), {
    resolveRoot: async (rootId) => {
      const root = roots.find((root) => root.id === rootId);
      if (!root) throw new Error(`Missing test root: ${rootId}`);
      return root;
    },
    journal: createMemoryPublicationJournal(),
    commit: () => undefined,
    fileSystem: publicationFs,
  });
  return plan.targetVideoPath;
};

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-file-organizer-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const expectPathExists = async (path: string): Promise<void> => {
  await expect(access(path)).resolves.toBeUndefined();
};

describe("FileOrganizer filesystem organize", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map(async (dirPath) => {
        await rm(dirPath, { recursive: true, force: true });
      }),
    );
  });

  it("prepares output paths for collisions and valid in-place renames", async () => {
    const root = await createTempDir();

    const collisionSourcePath = join(root, "source.mp4");
    const existingTargetPath = join(root, "output", "XYZ-999-CEN", "XYZ-999-CEN.mp4");
    await writeFile(collisionSourcePath, "video", "utf8");
    await mkdir(join(root, "output", "XYZ-999-CEN"), { recursive: true });
    await writeFile(existingTargetPath, "existing", "utf8");

    const organizer = new FileOrganizer();
    const collisionConfig = createConfig({
      paths: {
        mediaPath: root,
        successOutputFolder: "output",
      },
      naming: {
        folderTemplate: "{number}",
        fileTemplate: "{number}",
      },
      behavior: {
        successFileMove: true,
        successFileRename: true,
      },
    });

    const collisionPlan = organizer.plan(
      createFileInfo({
        filePath: collisionSourcePath,
        fileName: "source",
      }),
      createCrawlerData({
        number: "XYZ-999",
      }),
      collisionConfig,
    );
    const preparedCollision = await organizer.resolveOutputPlan(collisionPlan, collisionSourcePath);

    expect(preparedCollision.targetVideoPath).toBe(join(root, "output", "XYZ-999-CEN", "XYZ-999-CEN.mp4"));
    expect(preparedCollision.nfoPath).toBe(join(root, "output", "XYZ-999-CEN", "XYZ-999-CEN.nfo"));

    const inPlaceRoot = await createTempDir();
    const sourcePath = join(inPlaceRoot, "source.mp4");
    await writeFile(sourcePath, "video", "utf8");

    const inPlaceConfig = createConfig({
      naming: {
        fileTemplate: "{number}",
      },
      behavior: {
        successFileMove: false,
        successFileRename: true,
      },
    });

    const inPlaceFileInfo = createFileInfo({
      filePath: sourcePath,
      fileName: "source",
    });
    const inPlacePlan = organizer.plan(
      inPlaceFileInfo,
      createCrawlerData({
        number: "XYZ-999",
      }),
      inPlaceConfig,
    );
    const preparedInPlace = await organizer.resolveOutputPlan(inPlacePlan, sourcePath);
    const resultPath = await publishVideo(
      inPlaceFileInfo,
      preparedInPlace,
      inPlaceConfig,
      inPlaceConfig.paths.mediaPath,
    );

    expect(resultPath).toBe(join(inPlaceRoot, "XYZ-999-CEN.mp4"));
    await expectPathExists(resultPath);
  });

  it("mirrors metadata locally and writes STRM after organizing the video", async () => {
    const root = await createTempDir();
    const mediaRoot = join(root, "media");
    const metadataRoot = join(root, "metadata");
    const sourcePath = join(mediaRoot, "incoming", "ABC-123.mp4");
    await mkdir(dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, "video", "utf8");

    const organizer = new FileOrganizer();
    const config = createConfig({
      paths: {
        mediaPath: mediaRoot,
        metadataPath: metadataRoot,
        successOutputFolder: "organized",
      },
      naming: {
        folderTemplate: "{actor}/{number}",
        fileTemplate: "{number}",
      },
      behavior: {
        successFileMove: true,
        successFileRename: true,
      },
    });
    const fileInfo = createFileInfo({ filePath: sourcePath, fileName: "ABC-123" });
    const plan = await organizer.resolveOutputPlan(
      organizer.plan(fileInfo, createCrawlerData({ actors: ["Actor A"] }), config),
      sourcePath,
    );

    expect(plan).toMatchObject({
      outputDir: join(mediaRoot, "organized", "Actor A", "ABC-123-CEN"),
      metadataDir: join(metadataRoot, "organized", "Actor A", "ABC-123-CEN"),
      nfoPath: join(metadataRoot, "organized", "Actor A", "ABC-123-CEN", "ABC-123-CEN.nfo"),
      strmPath: join(metadataRoot, "organized", "Actor A", "ABC-123-CEN", "ABC-123-CEN.strm"),
    });

    const organizedPath = await publishVideo(fileInfo, plan, config, config.paths.mediaPath);

    await expect(readFile(plan.strmPath as string, "utf8")).resolves.toBe(resolve(organizedPath));
    await expectPathExists(organizedPath);
  });

  it("copies the playable target when separated metadata is generated from a source STRM", async () => {
    const root = await createTempDir();
    const mediaRoot = join(root, "media");
    const metadataRoot = join(root, "metadata");
    const sourcePath = join(mediaRoot, "incoming", "ABC-123.strm");
    await mkdir(dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, "https://example.com/ABC-123.m3u8", "utf8");

    const organizer = new FileOrganizer();
    const config = createConfig({
      paths: { mediaPath: mediaRoot, metadataPath: metadataRoot, successOutputFolder: "organized" },
      naming: { folderTemplate: "{number}", fileTemplate: "{number}" },
    });
    const fileInfo = createFileInfo({ filePath: sourcePath, fileName: "ABC-123", extension: ".strm" });
    const plan = await organizer.resolveOutputPlan(organizer.plan(fileInfo, createCrawlerData(), config), sourcePath);

    await publishVideo(fileInfo, plan, config, config.paths.mediaPath);

    await expect(readFile(plan.strmPath as string, "utf8")).resolves.toBe("https://example.com/ABC-123.m3u8");
  });

  it.each([false, true])("uses the same output rules in single and batch mode (move=%s)", async (successFileMove) => {
    const root = await createTempDir();
    const sourceDir = join(root, "picked");
    const sourcePath = join(sourceDir, "ABC-123.mp4");
    const organizer = new FileOrganizer();
    const config = createConfig({
      paths: {
        mediaPath: join(root, "batch-output"),
        metadataPath: join(root, "batch-metadata"),
        successOutputFolder: "organized",
      },
      behavior: { successFileMove },
      naming: { folderTemplate: "{actor}/{number}", fileTemplate: "{number}" },
    });

    const plan = organizer.plan(createFileInfo({ filePath: sourcePath }), createCrawlerData(), config, undefined, {
      executionMode: "single",
    });

    const batchPlan = organizer.plan(createFileInfo({ filePath: sourcePath }), createCrawlerData(), config, undefined, {
      executionMode: "batch",
    });
    expect(plan).toEqual(batchPlan);
    expect(plan.metadataDir).toContain(join(root, "batch-metadata"));
    expect(plan.metadataDir).not.toBe(sourceDir);
    expect(plan.strmPath).toBeDefined();
  });

  it.each(
    [false, true].flatMap((successFileMove) =>
      [false, true].flatMap((successFileRename) =>
        [false, true].flatMap((separate) =>
          ["ABC-123-original", "ABC-123-CEN"].flatMap((sourceBase) =>
            ["ABC-123", sourceBase].map((subtitleBase) => ({
              successFileMove,
              successFileRename,
              separate,
              subtitleBase,
              sourceBase,
            })),
          ),
        ),
      ),
    ),
  )("keeps movement, renaming and metadata separation independent ($successFileMove/$successFileRename/$separate)", async ({
    successFileMove,
    successFileRename,
    separate,
    subtitleBase,
    sourceBase,
  }) => {
    const root = await createTempDir();
    const source = join(root, "downloads", `${sourceBase}.mp4`);
    await mkdir(dirname(source), { recursive: true });
    await writeFile(source, "video");
    const subtitles = [".zh.forced.srt", ".en.sdh.ass", ".idx", ".sub"];
    for (const suffix of subtitles) await writeFile(join(dirname(source), `${subtitleBase}${suffix}`), suffix);
    await writeFile(join(dirname(source), "movie.nfo"), "original NFO");
    await writeFile(join(dirname(source), "poster.jpg"), "original poster");
    if (separate) await writeFile(join(dirname(source), "DEF-456.mp4"), "another video");
    const config = createConfig({
      paths: {
        mediaPath: join(root, "media"),
        metadataPath: separate ? join(root, "metadata") : "",
        successOutputFolder: "organized",
      },
      naming: { folderTemplate: "{number}", fileTemplate: "{number}" },
      behavior: { successFileMove, successFileRename, failedFileMove: false },
    });
    const organizer = new FileOrganizer();
    const info = createFileInfo({ filePath: source, fileName: sourceBase });
    const plan = await organizer.resolveOutputPlan(organizer.plan(info, createCrawlerData(), config), source);
    await publishVideo(info, plan, config, dirname(source));
    expect(await readFile(plan.targetVideoPath, "utf8")).toBe("video");
    expect(dirname(plan.targetVideoPath) === dirname(source)).toBe(!successFileMove);
    expect(parse(plan.targetVideoPath).base).toBe(successFileRename ? "ABC-123-CEN.mp4" : `${sourceBase}.mp4`);
    for (const suffix of subtitles)
      expect(
        await readFile(
          join(
            dirname(plan.targetVideoPath),
            `${successFileRename ? parse(plan.targetVideoPath).name : subtitleBase}${suffix}`,
          ),
          "utf8",
        ),
      ).toBe(suffix);
    if (separate) {
      expect(parse(plan.strmPath as string).base).toBe("ABC-123-CEN.strm");
      expect(await readFile(plan.strmPath as string, "utf8")).toBe(plan.targetVideoPath);
      for (const suffix of subtitles)
        expect(await readFile(join(plan.metadataDir as string, `ABC-123-CEN${suffix}`), "utf8")).toBe(suffix);
      expect(await fileUtils.listVideoFiles(plan.metadataDir as string)).toEqual([plan.strmPath]);
    }
    expect(await readFile(join(dirname(source), "movie.nfo"), "utf8")).toBe("original NFO");
    expect(await readFile(join(dirname(source), "poster.jpg"), "utf8")).toBe("original poster");
    if (!successFileMove && !successFileRename) {
      const before = (await fs.readdir(dirname(source))).sort();
      await publishVideo(info, plan, config, dirname(source));
      expect((await fs.readdir(dirname(source))).sort()).toEqual(before);
      expect(await readFile(source, "utf8")).toBe("video");
    }
  });

  it("rejects overlapping media and metadata roots before creating output", async () => {
    const root = await createTempDir();
    const mediaRoot = join(root, "media");
    const sourcePath = join(mediaRoot, "ABC-123.mp4");
    const organizer = new FileOrganizer();
    const config = createConfig({
      paths: { mediaPath: mediaRoot, metadataPath: join(mediaRoot, "metadata") },
    });

    expect(() => organizer.plan(createFileInfo({ filePath: sourcePath }), createCrawlerData(), config)).toThrow(
      "元数据输出目录不能与媒体目录相同或互相包含",
    );
  });

  it("moves matching subtitle sidecars alongside successful video moves", async () => {
    const root = await createTempDir();
    const sourcePath = join(root, "source.mp4");
    const subtitlePath = join(root, "source.zh.srt");

    await writeFile(sourcePath, "video", "utf8");
    await writeFile(subtitlePath, "subtitle", "utf8");

    const organizer = new FileOrganizer();
    const successConfig = createConfig({
      paths: {
        mediaPath: root,
        successOutputFolder: "output",
      },
      naming: {
        folderTemplate: "{number}",
        fileTemplate: "{number}",
      },
      behavior: {
        successFileMove: true,
        successFileRename: true,
      },
    });

    const fileInfo = createFileInfo({
      filePath: sourcePath,
      fileName: "source",
    });
    const plan = organizer.plan(
      fileInfo,
      createCrawlerData({
        number: "XYZ-999",
      }),
      successConfig,
    );
    const preparedPlan = await organizer.resolveOutputPlan(plan, sourcePath);

    await publishVideo(fileInfo, preparedPlan, successConfig, successConfig.paths.mediaPath);

    await expectPathExists(join(root, "output", "XYZ-999-CEN", "XYZ-999-CEN.mp4"));
    await expectPathExists(join(root, "output", "XYZ-999-CEN", "XYZ-999-CEN.zh.srt"));
    await expect(access(subtitlePath)).rejects.toThrow();
  });

  it("moves generated FC2 feature videos alongside successful movie moves", async () => {
    const root = await createTempDir();
    const sourcePath = join(root, "FC2-PPV-123456.mp4");
    const featurePath = join(root, "FC2-PPV-123456-花絮.mp4");
    const giftPath = join(root, "FC2-PPV-123456_gift.mp4");

    await writeFile(sourcePath, "video", "utf8");
    await writeFile(featurePath, "feature", "utf8");
    await writeFile(giftPath, "gift", "utf8");

    const organizer = new FileOrganizer();
    const successConfig = createConfig({
      paths: {
        mediaPath: root,
        successOutputFolder: "output",
      },
      naming: {
        folderTemplate: "{number}",
        fileTemplate: "{number}",
      },
      behavior: {
        successFileMove: true,
        successFileRename: true,
      },
    });

    const fileInfo = createFileInfo({
      filePath: sourcePath,
      fileName: "FC2-PPV-123456",
      number: "FC2-123456",
    });
    const plan = organizer.plan(
      fileInfo,
      createCrawlerData({
        number: "FC2-123456",
        website: Website.FC2,
      }),
      successConfig,
    );
    const preparedPlan = await organizer.resolveOutputPlan(plan, sourcePath);
    const movieBaseName = parse(preparedPlan.nfoPath).name;

    await publishVideo(fileInfo, preparedPlan, successConfig, successConfig.paths.mediaPath);

    await expectPathExists(preparedPlan.targetVideoPath);
    await expectPathExists(join(preparedPlan.outputDir, `${movieBaseName}-花絮.mp4`));
    await expectPathExists(join(preparedPlan.outputDir, `${movieBaseName}_gift.mp4`));
    await expect(access(featurePath)).rejects.toThrow();
    await expect(access(giftPath)).rejects.toThrow();
  });

  it("moves matching subtitle sidecars alongside failed video moves", async () => {
    const organizer = new FileOrganizer();
    const failedRoot = await createTempDir();
    const failedVideoPath = join(failedRoot, "FAIL-001.mp4");
    const failedSubtitlePath = join(failedRoot, "FAIL-001.ass");
    await writeFile(failedVideoPath, "video", "utf8");
    await writeFile(failedSubtitlePath, "subtitle", "utf8");

    const failedFileInfo = createFileInfo({
      filePath: failedVideoPath,
      fileName: "FAIL-001",
      number: "FAIL-001",
      extension: ".mp4",
    });
    const failedConfig = createConfig({
      paths: {
        mediaPath: failedRoot,
        failedOutputFolder: "failed",
      },
    });

    await organizer.moveToFailedFolder(failedFileInfo.filePath, failedRoot, failedConfig);

    await expectPathExists(join(failedRoot, "failed", "FAIL-001.mp4"));
    await expectPathExists(join(failedRoot, "failed", "FAIL-001.ass"));
    await expect(access(failedSubtitlePath)).rejects.toThrow();
  });

  it("rewrites relative .strm targets to absolute paths when moving to a different success directory", async () => {
    const organizer = new FileOrganizer();
    const root = await createTempDir();
    const sourceDir = join(root, "library");
    const sourcePath = join(sourceDir, "ABC-123.strm");

    await mkdir(sourceDir, { recursive: true });
    await writeFile(sourcePath, "../videos/ABC-123.mp4", "utf8");

    const fileInfo = createFileInfo({
      filePath: sourcePath,
      fileName: "ABC-123",
      extension: ".strm",
    });
    const config = createConfig({
      paths: {
        mediaPath: root,
        successOutputFolder: "output",
      },
      naming: {
        folderTemplate: "{number}",
        fileTemplate: "{number}",
      },
      behavior: {
        successFileMove: true,
        successFileRename: true,
      },
    });
    const plan = organizer.plan(
      fileInfo,
      createCrawlerData({
        number: "ABC-123",
      }),
      config,
    );
    const preparedPlan = await organizer.resolveOutputPlan(plan, sourcePath);
    const movedPath = await publishVideo(fileInfo, preparedPlan, config, config.paths.mediaPath);

    expect(movedPath).toBe(join(root, "output", "ABC-123-CEN", "ABC-123-CEN.strm"));
    await expect(readFile(movedPath, "utf8")).resolves.toBe(join(root, "videos", "ABC-123.mp4"));
    await expect(access(sourcePath)).rejects.toThrow();
  });

  it("rewrites relative .strm targets to absolute paths when moving to the failed directory", async () => {
    const organizer = new FileOrganizer();
    const root = await createTempDir();
    const sourcePath = join(root, "FAIL-001.strm");

    await writeFile(sourcePath, "../videos/FAIL-001.mp4", "utf8");

    const fileInfo = createFileInfo({
      filePath: sourcePath,
      fileName: "FAIL-001",
      number: "FAIL-001",
      extension: ".strm",
    });
    const config = createConfig({
      paths: {
        mediaPath: root,
        failedOutputFolder: "failed",
      },
    });

    const movedPath = await organizer.moveToFailedFolder(fileInfo.filePath, root, config);

    expect(movedPath).toBe(join(root, "failed", "FAIL-001.strm"));
    await expect(readFile(movedPath, "utf8")).resolves.toBe(resolve(dirname(sourcePath), "../videos/FAIL-001.mp4"));
    await expect(access(sourcePath)).rejects.toThrow();
  });

  it("allows moving .strm files with KODIPROP-backed stream urls", async () => {
    const organizer = new FileOrganizer();
    const root = await createTempDir();
    const sourceDir = join(root, "library");
    const sourcePath = join(sourceDir, "ABC-123.strm");

    await mkdir(sourceDir, { recursive: true });
    await writeFile(sourcePath, "#KODIPROP:rtsp_transport=tcp\nrtsp://example.com/live", "utf8");

    const fileInfo = createFileInfo({
      filePath: sourcePath,
      fileName: "ABC-123",
      extension: ".strm",
    });
    const config = createConfig({
      paths: {
        mediaPath: root,
        successOutputFolder: "output",
      },
      naming: {
        folderTemplate: "{number}",
        fileTemplate: "{number}",
      },
      behavior: {
        successFileMove: true,
        successFileRename: true,
      },
    });
    const plan = organizer.plan(
      fileInfo,
      createCrawlerData({
        number: "ABC-123",
      }),
      config,
    );

    await expect(organizer.resolveOutputPlan(plan, sourcePath)).resolves.toMatchObject({
      targetVideoPath: join(root, "output", "ABC-123-CEN", "ABC-123-CEN.strm"),
    });
  });

  it("supports absolute success and failed output directories without duplicating the base path", async () => {
    const organizer = new FileOrganizer();
    const root = await createTempDir();
    const mediaRoot = join(root, "media");
    const absoluteSuccessDir = join(root, "absolute-success");
    const absoluteFailedDir = join(root, "absolute-failed");
    const sourcePath = join(mediaRoot, "library", "ABC-123.mp4");
    const failedSourcePath = join(mediaRoot, "library", "FAIL-001.mp4");

    await mkdir(join(mediaRoot, "library"), { recursive: true });
    await writeFile(sourcePath, "video", "utf8");
    await writeFile(failedSourcePath, "video", "utf8");

    const config = createConfig({
      paths: {
        mediaPath: mediaRoot,
        successOutputFolder: absoluteSuccessDir,
        failedOutputFolder: absoluteFailedDir,
      },
      naming: {
        folderTemplate: "{number}",
        fileTemplate: "{number}",
      },
      behavior: {
        successFileMove: true,
        successFileRename: true,
      },
    });

    const fileInfo = createFileInfo({
      filePath: sourcePath,
      fileName: "ABC-123",
    });
    const plan = organizer.plan(
      fileInfo,
      createCrawlerData({
        number: "ABC-123",
      }),
      config,
    );
    const preparedPlan = await organizer.resolveOutputPlan(plan, sourcePath);

    expect(preparedPlan.outputDir).toBe(join(absoluteSuccessDir, "ABC-123-CEN"));
    expect(preparedPlan.targetVideoPath).toBe(join(absoluteSuccessDir, "ABC-123-CEN", "ABC-123-CEN.mp4"));

    const failedFileInfo = createFileInfo({
      filePath: failedSourcePath,
      fileName: "FAIL-001",
      number: "FAIL-001",
    });
    const failedTargetPath = await organizer.moveToFailedFolder(failedFileInfo.filePath, mediaRoot, config);

    expect(failedTargetPath).toBe(join(absoluteFailedDir, "FAIL-001.mp4"));
    await expectPathExists(failedTargetPath);
  });

  it("moves generated FC2 feature videos alongside failed movie moves", async () => {
    const organizer = new FileOrganizer();
    const failedRoot = await createTempDir();
    const failedVideoPath = join(failedRoot, "FC2-123456-1.mp4");
    const failedFeaturePath = join(failedRoot, "FC2-123456-花絮.mp4");
    const failedGiftPath = join(failedRoot, "FC2-123456_gift.mp4");
    await writeFile(failedVideoPath, "video", "utf8");
    await writeFile(failedFeaturePath, "feature", "utf8");
    await writeFile(failedGiftPath, "gift", "utf8");

    const failedFileInfo = createFileInfo({
      filePath: failedVideoPath,
      fileName: "FC2-123456-1",
      number: "FC2-123456",
      extension: ".mp4",
      part: {
        number: 1,
        suffix: "-1",
      },
    });
    const failedConfig = createConfig({
      paths: {
        mediaPath: failedRoot,
        failedOutputFolder: "failed",
      },
    });

    await organizer.moveToFailedFolder(failedFileInfo.filePath, failedRoot, failedConfig);

    await expectPathExists(join(failedRoot, "failed", "FC2-123456-1.mp4"));
    await expectPathExists(join(failedRoot, "failed", "FC2-123456-花絮.mp4"));
    await expectPathExists(join(failedRoot, "failed", "FC2-123456_gift.mp4"));
    await expect(access(failedFeaturePath)).rejects.toThrow();
    await expect(access(failedGiftPath)).rejects.toThrow();
  });

  it("rolls back the video move when a subtitle sidecar move fails", async () => {
    const organizer = new FileOrganizer();
    const root = await createTempDir();
    const sourcePath = join(root, "source.mp4");
    const subtitlePath = join(root, "source.zh.srt");

    await writeFile(sourcePath, "video", "utf8");
    await writeFile(subtitlePath, "subtitle", "utf8");

    const config = createConfig({
      paths: {
        mediaPath: root,
        successOutputFolder: "output",
      },
      naming: {
        folderTemplate: "{number}",
        fileTemplate: "{number}",
      },
      behavior: {
        successFileMove: true,
        successFileRename: true,
      },
    });
    const fileInfo = createFileInfo({
      filePath: sourcePath,
      fileName: "source",
    });
    const plan = await organizer.resolveOutputPlan(
      organizer.plan(
        fileInfo,
        createCrawlerData({
          number: "XYZ-999",
        }),
        config,
      ),
      sourcePath,
    );

    const originalMoveFileSafely = fs.rename;
    vi.spyOn(publicationFs, "rename").mockImplementation(async (fromPath, toPath) => {
      if (fromPath === subtitlePath) {
        throw new Error("mock subtitle move failure");
      }

      return originalMoveFileSafely(fromPath, toPath);
    });

    await expect(publishVideo(fileInfo, plan, config, config.paths.mediaPath)).rejects.toThrow("mock");
    await expectPathExists(sourcePath);
    await expectPathExists(subtitlePath);
    await expect(access(join(root, "output", "XYZ-999-CEN", "XYZ-999-CEN.mp4"))).rejects.toThrow();
    await expect(access(join(root, "output", "XYZ-999-CEN", "XYZ-999-CEN.zh.srt"))).rejects.toThrow();
  });

  it("restores the original relative .strm content when a move is rolled back", async () => {
    const organizer = new FileOrganizer();
    const root = await createTempDir();
    const sourcePath = join(root, "source.strm");
    const subtitlePath = join(root, "source.zh.srt");

    await writeFile(sourcePath, "../videos/source.mp4", "utf8");
    await writeFile(subtitlePath, "subtitle", "utf8");

    const config = createConfig({
      paths: {
        mediaPath: root,
        successOutputFolder: "output",
      },
      naming: {
        folderTemplate: "{number}",
        fileTemplate: "{number}",
      },
      behavior: {
        successFileMove: true,
        successFileRename: true,
      },
    });
    const fileInfo = createFileInfo({
      filePath: sourcePath,
      fileName: "source",
      extension: ".strm",
      number: "XYZ-999",
    });
    const plan = await organizer.resolveOutputPlan(
      organizer.plan(
        fileInfo,
        createCrawlerData({
          number: "XYZ-999",
        }),
        config,
      ),
      sourcePath,
    );

    const originalMoveFileSafely = fs.rename;
    vi.spyOn(publicationFs, "rename").mockImplementation(async (fromPath, toPath) => {
      if (fromPath === subtitlePath) {
        throw new Error("mock subtitle move failure");
      }

      return originalMoveFileSafely(fromPath, toPath);
    });

    await expect(publishVideo(fileInfo, plan, config, config.paths.mediaPath)).rejects.toThrow("mock");
    await expect(readFile(sourcePath, "utf8")).resolves.toBe("../videos/source.mp4");
    await expect(access(join(root, "output", "XYZ-999-CEN", "XYZ-999-CEN.strm"))).rejects.toThrow();
  });

  it("rolls back the movie move when a generated FC2 feature move fails", async () => {
    const organizer = new FileOrganizer();
    const root = await createTempDir();
    const sourcePath = join(root, "FC2-123456-1.mp4");
    const featurePath = join(root, "FC2-123456-花絮.mp4");

    await writeFile(sourcePath, "video", "utf8");
    await writeFile(featurePath, "feature", "utf8");

    const config = createConfig({
      paths: {
        mediaPath: root,
        successOutputFolder: "output",
      },
      naming: {
        folderTemplate: "{number}",
        fileTemplate: "{number}",
      },
      behavior: {
        successFileMove: true,
        successFileRename: true,
      },
    });
    const fileInfo = createFileInfo({
      filePath: sourcePath,
      fileName: "FC2-123456-1",
      number: "FC2-123456",
      part: {
        number: 1,
        suffix: "-1",
      },
    });
    const plan = await organizer.resolveOutputPlan(
      organizer.plan(
        fileInfo,
        createCrawlerData({
          number: "FC2-123456",
          website: Website.FC2,
        }),
        config,
      ),
      sourcePath,
    );

    const originalMoveFileSafely = fs.rename;
    vi.spyOn(publicationFs, "rename").mockImplementation(async (fromPath, toPath) => {
      if (fromPath === featurePath) {
        throw new Error("mock generated sidecar move failure");
      }

      return originalMoveFileSafely(fromPath, toPath);
    });

    await expect(publishVideo(fileInfo, plan, config, config.paths.mediaPath)).rejects.toThrow("mock");
    await expectPathExists(sourcePath);
    await expectPathExists(featurePath);
    await expect(access(join(root, "output", "FC2-123456", "FC2-123456-cd1.mp4"))).rejects.toThrow();
    await expect(access(join(root, "output", "FC2-123456", "FC2-123456-花絮.mp4"))).rejects.toThrow();
  });

  it("skips disk checks for valid in-place renames and still rejects multiple source videos", async () => {
    const validRoot = await createTempDir();
    const validSourcePath = join(validRoot, "source.mp4");
    await writeFile(validSourcePath, "video", "utf8");
    await writeFile(join(validRoot, "trailer.mp4"), "video", "utf8");

    const diskSpaceSpy = vi.spyOn(fileUtils, "hasEnoughDiskSpace").mockResolvedValue(false);

    const organizer = new FileOrganizer();
    const config = createConfig({
      naming: {
        fileTemplate: "{number}",
      },
      behavior: {
        successFileMove: false,
        successFileRename: true,
      },
    });

    const validPlan = organizer.plan(
      createFileInfo({
        filePath: validSourcePath,
        fileName: "source",
      }),
      createCrawlerData({
        number: "XYZ-999",
      }),
      config,
    );

    await expect(organizer.resolveOutputPlan(validPlan, validSourcePath)).resolves.toMatchObject({
      targetVideoPath: join(validRoot, "XYZ-999-CEN.mp4"),
      nfoPath: join(validRoot, "XYZ-999-CEN.nfo"),
    });
    expect(diskSpaceSpy).not.toHaveBeenCalled();

    const multipartRoot = await createTempDir();
    const multipartSourcePath = join(multipartRoot, "FC2-123456-1.mp4");
    await writeFile(multipartSourcePath, "video", "utf8");
    await writeFile(join(multipartRoot, "FC2-123456-2.mp4"), "video", "utf8");
    await writeFile(join(multipartRoot, "FC2-123456-花絮.mp4"), "video", "utf8");

    const multipartPlan = organizer.plan(
      createFileInfo({
        filePath: multipartSourcePath,
        fileName: "FC2-123456-1",
        number: "FC2-123456",
        part: {
          number: 1,
          suffix: "-1",
        },
      }),
      createCrawlerData({
        number: "FC2-123456",
      }),
      createConfig({
        behavior: {
          successFileMove: false,
          successFileRename: true,
        },
      }),
    );

    await expect(organizer.resolveOutputPlan(multipartPlan, multipartSourcePath)).resolves.toMatchObject({
      targetVideoPath: join(multipartRoot, "FC2-123456-1.mp4"),
      nfoPath: join(multipartRoot, "FC2-123456.nfo"),
    });

    const invalidRoot = await createTempDir();
    const invalidSourcePath = join(invalidRoot, "source.mp4");
    await writeFile(invalidSourcePath, "video", "utf8");
    await writeFile(join(invalidRoot, "another.mkv"), "video", "utf8");

    const invalidPlan = organizer.plan(
      createFileInfo({
        filePath: invalidSourcePath,
        fileName: "source",
      }),
      createCrawlerData({
        number: "XYZ-999",
      }),
      config,
    );

    await expect(organizer.resolveOutputPlan(invalidPlan, invalidSourcePath)).rejects.toThrow(
      "源目录包含多部影片，请设置元数据输出目录或使用按影片命名的 NFO 和图片",
    );
  });

  it("allows multipart videos to reuse an existing shared base NFO without hanging", async () => {
    const root = await createTempDir();
    const organizer = new FileOrganizer();
    const config = createConfig({
      paths: {
        mediaPath: root,
        successOutputFolder: "output",
      },
      naming: {
        folderTemplate: "{number}",
        fileTemplate: "{number}",
      },
      behavior: {
        successFileMove: true,
        successFileRename: true,
      },
    });
    const fileInfo = createFileInfo({
      filePath: join(root, "FC2-123456-cd2.mp4"),
      fileName: "FC2-123456-cd2",
      number: "FC2-123456",
      part: {
        number: 2,
        suffix: "-cd2",
      },
    });
    const plan = organizer.plan(
      fileInfo,
      createCrawlerData({
        number: "FC2-123456",
      }),
      config,
    );

    await writeFile(fileInfo.filePath, "video", "utf8");
    await mkdir(plan.outputDir, { recursive: true });
    await writeFile(join(plan.outputDir, "FC2-123456.nfo"), "<movie />", "utf8");

    await expect(organizer.resolveOutputPlan(plan, fileInfo.filePath)).resolves.toMatchObject({
      targetVideoPath: join(root, "output", "FC2-123456", "FC2-123456-cd2.mp4"),
      nfoPath: join(root, "output", "FC2-123456", "FC2-123456.nfo"),
    });
  });
});

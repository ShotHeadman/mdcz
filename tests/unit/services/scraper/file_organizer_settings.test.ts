import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { FileOrganizer } from "@main/services/scraper/FileOrganizer";
import {
  buildGeneratedVideoSidecarTargetPath,
  isGeneratedSidecarVideo,
} from "@main/services/scraper/generatedSidecarVideos";
import * as fileUtils from "@main/utils/file";
import { Website } from "@shared/enums";
import type { CrawlerData, FileInfo } from "@shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-file-organizer-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const createFileInfo = (overrides: Partial<FileInfo> = {}): FileInfo => {
  return {
    filePath: "/input/ABC-123.mp4",
    fileName: "ABC-123",
    extension: ".mp4",
    number: "ABC-123",
    isSubtitled: false,
    ...overrides,
  };
};

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => {
  return {
    title: "Sample Title",
    number: "ABC-123",
    actors: [],
    genres: [],
    scene_images: [],
    website: Website.DMM,
    ...overrides,
  };
};

interface ConfigOverrides {
  paths?: Partial<typeof defaultConfiguration.paths>;
  naming?: Partial<typeof defaultConfiguration.naming>;
  behavior?: Partial<typeof defaultConfiguration.behavior>;
  download?: Partial<typeof defaultConfiguration.download>;
}

const createConfig = (overrides: ConfigOverrides = {}) => {
  return configurationSchema.parse({
    ...defaultConfiguration,
    paths: {
      ...defaultConfiguration.paths,
      mediaPath: "/media",
      successOutputFolder: "output",
      ...overrides.paths,
    },
    naming: {
      ...defaultConfiguration.naming,
      censoredStyle: "-CEN",
      ...overrides.naming,
    },
    behavior: {
      ...defaultConfiguration.behavior,
      ...overrides.behavior,
    },
    download: {
      ...defaultConfiguration.download,
      ...overrides.download,
    },
  });
};

const expectPathExists = async (path: string): Promise<void> => {
  await expect(access(path)).resolves.toBeUndefined();
};

describe("FileOrganizer naming settings", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map(async (dirPath) => {
        await rm(dirPath, { recursive: true, force: true });
      }),
    );
  });

  it("renders file and folder names with markers, release dates, and empty template fields", () => {
    const cases = [
      {
        config: createConfig({
          naming: {
            cnwordStyle: "-SUB",
            umrStyle: "-UMR",
            leakStyle: "-LEAK",
            uncensoredStyle: "-UNC",
            censoredStyle: "-CEN",
          },
        }),
        fileInfo: createFileInfo({
          isSubtitled: true,
          subtitleTag: "中文字幕",
        }),
        crawlerData: createCrawlerData({
          number: "FC2-123456",
          genres: ["流出", "破解"],
        }),
        assert: (plan: ReturnType<FileOrganizer["plan"]>) => {
          expect(parse(plan.targetVideoPath).name).toBe("FC2-123456-SUB-UMR-LEAK-UNC");
        },
      },
      {
        config: createConfig({
          naming: {
            cnwordStyle: "-SUB",
            censoredStyle: "-CEN",
          },
        }),
        fileInfo: createFileInfo({
          isSubtitled: true,
          subtitleTag: "字幕",
        }),
        crawlerData: createCrawlerData({
          number: "ABC-123",
        }),
        assert: (plan: ReturnType<FileOrganizer["plan"]>) => {
          expect(parse(plan.targetVideoPath).name).toBe("ABC-123-CEN");
        },
      },
      {
        config: createConfig({
          naming: {
            folderTemplate: "{date}-{number}",
            fileTemplate: "{date}-{number}",
            releaseRule: "YYYY.MM.DD",
            folderNameMax: 12,
            fileNameMax: 12,
          },
        }),
        fileInfo: createFileInfo(),
        crawlerData: createCrawlerData({
          number: "ABCD-1234",
          release_date: "2024-1-2",
        }),
        assert: (plan: ReturnType<FileOrganizer["plan"]>) => {
          const folderName = parse(plan.outputDir).base;
          const renderedFileName = parse(plan.targetVideoPath).name;
          expect(folderName.startsWith("2024.01.02")).toBe(true);
          expect(renderedFileName.startsWith("2024.01.02")).toBe(true);
          expect(folderName.length).toBeLessThanOrEqual(12);
          expect(renderedFileName.length).toBeLessThanOrEqual(12);
        },
      },
      {
        config: createConfig({
          naming: {
            folderTemplate: "{studio}/{number}",
            fileTemplate: "{studio} - {number}",
          },
        }),
        fileInfo: createFileInfo({
          filePath: "/input/source.mp4",
          fileName: "source",
        }),
        crawlerData: createCrawlerData({
          number: "XYZ-999",
          studio: undefined,
        }),
        assert: (plan: ReturnType<FileOrganizer["plan"]>) => {
          expect(parse(plan.outputDir).base).toBe("XYZ-999-CEN");
          expect(parse(plan.targetVideoPath).name).toBe("XYZ-999-CEN");
        },
      },
    ];

    const organizer = new FileOrganizer();

    for (const { config, fileInfo, crawlerData, assert } of cases) {
      assert(organizer.plan(fileInfo, crawlerData, config));
    }
  });

  it("formats multipart suffixes according to the configured style while keeping NFO on the base name", () => {
    const organizer = new FileOrganizer();
    const explicitPartPlan = organizer.plan(
      createFileInfo({
        filePath: "/input/XYZ-999-CD1.mp4",
        fileName: "XYZ-999-CD1",
        part: {
          number: 1,
          suffix: "-CD1",
        },
      }),
      createCrawlerData({
        number: "XYZ-999",
      }),
      createConfig({
        naming: {
          fileTemplate: "{number}",
          partStyle: "DISC",
        },
      }),
    );

    expect(parse(explicitPartPlan.targetVideoPath).name).toBe("XYZ-999-CEN-DISC1");
    expect(parse(explicitPartPlan.nfoPath).name).toBe("XYZ-999-CEN");

    const numericPartPlan = organizer.plan(
      createFileInfo({
        filePath: "/input/XYZ-999-4.mp4",
        fileName: "XYZ-999-4",
        part: {
          number: 4,
          suffix: "-4",
        },
      }),
      createCrawlerData({
        number: "XYZ-999",
      }),
      createConfig({
        naming: {
          fileTemplate: "{number}",
          partStyle: "DISC",
        },
      }),
    );

    expect(parse(numericPartPlan.targetVideoPath).name).toBe("XYZ-999-CEN-DISC4");
    expect(parse(numericPartPlan.nfoPath).name).toBe("XYZ-999-CEN");
  });

  it("builds preview rows from the shared naming logic", () => {
    const organizer = new FileOrganizer();
    const previews = organizer.buildNamingPreview(
      createConfig({
        naming: {
          cnwordStyle: "-SUB",
          umrStyle: "-UMR",
          leakStyle: "-LEAK",
          censoredStyle: "-CEN",
        },
      }),
    );

    expect(previews.find((item) => item.label === "中文字幕")?.file).toContain("-SUB");
    expect(previews.find((item) => item.label === "多演员")?.folder).toContain("等演员");
  });

  it("preserves input extension and explicit multipart suffix casing when renaming", () => {
    const organizer = new FileOrganizer();
    const plan = organizer.plan(
      createFileInfo({
        filePath: "/input/XYZ-999-Part1.MP4",
        fileName: "XYZ-999-Part1",
        extension: ".MP4",
        part: {
          number: 1,
          suffix: "-Part1",
        },
      }),
      createCrawlerData({
        number: "XYZ-999",
      }),
      createConfig({
        naming: {
          fileTemplate: "{number}",
        },
      }),
    );

    expect(parse(plan.targetVideoPath).base).toBe("XYZ-999-CEN-Part1.MP4");
    expect(parse(plan.nfoPath).base).toBe("XYZ-999-CEN.nfo");
  });

  it("keeps video and NFO basenames aligned across move and rename modes", () => {
    const cases = [
      {
        config: createConfig({
          naming: {
            folderTemplate: "{number}",
            fileTemplate: "{number}",
          },
          behavior: {
            successFileMove: true,
            successFileRename: false,
          },
        }),
        fileInfo: createFileInfo({
          filePath: "/input/raw-source.mp4",
          fileName: "raw-source",
        }),
        crawlerData: createCrawlerData({
          number: "XYZ-999",
        }),
        assert: (plan: ReturnType<FileOrganizer["plan"]>) => {
          expect(parse(plan.targetVideoPath).base).toBe("raw-source.mp4");
          expect(parse(plan.nfoPath).base).toBe("raw-source.nfo");
        },
      },
      {
        config: createConfig({
          naming: {
            folderTemplate: "{number}",
            fileTemplate: "{number}",
          },
          behavior: {
            successFileMove: false,
            successFileRename: false,
          },
        }),
        fileInfo: createFileInfo({
          filePath: "/input/original-name.mp4",
          fileName: "original-name",
        }),
        crawlerData: createCrawlerData({
          number: "XYZ-999",
        }),
        assert: (plan: ReturnType<FileOrganizer["plan"]>) => {
          expect(plan.outputDir).toBe("/input");
          expect(plan.targetVideoPath).toBe(join("/input", "original-name.mp4"));
          expect(plan.nfoPath).toBe(join("/input", "original-name.nfo"));
        },
      },
      {
        config: createConfig({
          naming: {
            folderTemplate: "{number}",
            fileTemplate: "{number}",
          },
          behavior: {
            successFileMove: false,
            successFileRename: true,
          },
        }),
        fileInfo: createFileInfo({
          filePath: "/input/original-name.mp4",
          fileName: "original-name",
        }),
        crawlerData: createCrawlerData({
          number: "XYZ-999",
        }),
        assert: (plan: ReturnType<FileOrganizer["plan"]>) => {
          expect(plan.outputDir).toBe("/input");
          expect(plan.targetVideoPath).toBe(join("/input", "XYZ-999-CEN.mp4"));
          expect(plan.nfoPath).toBe(join("/input", "XYZ-999-CEN.nfo"));
        },
      },
    ];

    const organizer = new FileOrganizer();

    for (const { config, fileInfo, crawlerData, assert } of cases) {
      assert(organizer.plan(fileInfo, crawlerData, config));
    }
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
    const preparedCollision = await organizer.ensureOutputReady(collisionPlan, collisionSourcePath);

    expect(preparedCollision.targetVideoPath).toBe(join(root, "output", "XYZ-999-CEN", "XYZ-999-CEN (1).mp4"));
    expect(preparedCollision.nfoPath).toBe(join(root, "output", "XYZ-999-CEN", "XYZ-999-CEN (1).nfo"));

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
    const preparedInPlace = await organizer.ensureOutputReady(inPlacePlan, sourcePath);
    const resultPath = await organizer.organizeVideo(inPlaceFileInfo, preparedInPlace, inPlaceConfig);

    expect(resultPath).toBe(join(inPlaceRoot, "XYZ-999-CEN.mp4"));
    await expectPathExists(resultPath);
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
    const preparedPlan = await organizer.ensureOutputReady(plan, sourcePath);

    await organizer.organizeVideo(fileInfo, preparedPlan, successConfig);

    await expectPathExists(join(root, "output", "XYZ-999-CEN", "XYZ-999-CEN.mp4"));
    await expectPathExists(join(root, "output", "XYZ-999-CEN", "XYZ-999-CEN.zh.srt"));
    await expect(access(subtitlePath)).rejects.toThrow();
  });

  it("identifies generated FC2 sidecars and builds paths from the shared movie base name", () => {
    expect(isGeneratedSidecarVideo("FC2-123456_gift.mp4")).toBe(true);
    expect(
      buildGeneratedVideoSidecarTargetPath(
        {
          path: "FC2-123456-花絮.mp4",
          suffix: "-花絮",
        },
        "/library/FC2-123456",
        "FC2-123456",
      ),
    ).toBe(join("/library/FC2-123456", "FC2-123456-花絮.mp4"));
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
    const preparedPlan = await organizer.ensureOutputReady(plan, sourcePath);
    const movieBaseName = parse(preparedPlan.nfoPath).name;

    await organizer.organizeVideo(fileInfo, preparedPlan, successConfig);

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

    await organizer.moveToFailedFolder(failedFileInfo, failedConfig);

    await expectPathExists(join(failedRoot, "failed", "FAIL-001.mp4"));
    await expectPathExists(join(failedRoot, "failed", "FAIL-001.ass"));
    await expect(access(failedSubtitlePath)).rejects.toThrow();
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

    await organizer.moveToFailedFolder(failedFileInfo, failedConfig);

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
    const plan = await organizer.ensureOutputReady(
      organizer.plan(
        fileInfo,
        createCrawlerData({
          number: "XYZ-999",
        }),
        config,
      ),
      sourcePath,
    );

    const originalMoveFileSafely = fileUtils.moveFileSafely;
    vi.spyOn(fileUtils, "moveFileSafely").mockImplementation(async (fromPath, toPath) => {
      if (fromPath === subtitlePath) {
        throw new Error("mock subtitle move failure");
      }

      return originalMoveFileSafely(fromPath, toPath);
    });

    await expect(organizer.organizeVideo(fileInfo, plan, config)).rejects.toThrow("Failed to move bundled media");
    await expectPathExists(sourcePath);
    await expectPathExists(subtitlePath);
    await expect(access(join(root, "output", "XYZ-999-CEN", "XYZ-999-CEN.mp4"))).rejects.toThrow();
    await expect(access(join(root, "output", "XYZ-999-CEN", "XYZ-999-CEN.zh.srt"))).rejects.toThrow();
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
    const plan = await organizer.ensureOutputReady(
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

    const originalMoveFileSafely = fileUtils.moveFileSafely;
    vi.spyOn(fileUtils, "moveFileSafely").mockImplementation(async (fromPath, toPath) => {
      if (fromPath === featurePath) {
        throw new Error("mock generated sidecar move failure");
      }

      return originalMoveFileSafely(fromPath, toPath);
    });

    await expect(organizer.organizeVideo(fileInfo, plan, config)).rejects.toThrow("Failed to move bundled media");
    await expectPathExists(sourcePath);
    await expectPathExists(featurePath);
    await expect(access(join(root, "output", "FC2-123456", "FC2-123456-cd1.mp4"))).rejects.toThrow();
    await expect(access(join(root, "output", "FC2-123456", "FC2-123456-花絮.mp4"))).rejects.toThrow();
  });

  it("keeps video and subtitle sidecar basenames aligned when resolving collisions", async () => {
    const organizer = new FileOrganizer();
    const pairRoot = await createTempDir();
    const pairVideoPath = join(pairRoot, "pair.mp4");
    const pairIdxPath = join(pairRoot, "pair.idx");
    const pairSubPath = join(pairRoot, "pair.sub");
    const existingIdxPath = join(pairRoot, "output", "PAIR-001-CEN", "PAIR-001-CEN.idx");

    await writeFile(pairVideoPath, "video", "utf8");
    await writeFile(pairIdxPath, "subtitle", "utf8");
    await writeFile(pairSubPath, "subtitle", "utf8");
    await mkdir(join(pairRoot, "output", "PAIR-001-CEN"), { recursive: true });
    await writeFile(existingIdxPath, "existing", "utf8");

    const pairFileInfo = createFileInfo({
      filePath: pairVideoPath,
      fileName: "pair",
      number: "PAIR-001",
    });
    const pairConfig = createConfig({
      paths: {
        mediaPath: pairRoot,
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
    const pairPlan = organizer.plan(
      pairFileInfo,
      createCrawlerData({
        number: "PAIR-001",
      }),
      pairConfig,
    );
    const preparedPairPlan = await organizer.ensureOutputReady(pairPlan, pairVideoPath);

    expect(preparedPairPlan.targetVideoPath).toBe(join(pairRoot, "output", "PAIR-001-CEN", "PAIR-001-CEN (1).mp4"));
    expect(preparedPairPlan.nfoPath).toBe(join(pairRoot, "output", "PAIR-001-CEN", "PAIR-001-CEN (1).nfo"));

    await organizer.organizeVideo(pairFileInfo, preparedPairPlan, pairConfig);

    await expectPathExists(join(pairRoot, "output", "PAIR-001-CEN", "PAIR-001-CEN (1).mp4"));
    await expectPathExists(join(pairRoot, "output", "PAIR-001-CEN", "PAIR-001-CEN (1).idx"));
    await expectPathExists(join(pairRoot, "output", "PAIR-001-CEN", "PAIR-001-CEN (1).sub"));
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

    await expect(organizer.ensureOutputReady(validPlan, validSourcePath)).resolves.toMatchObject({
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

    await expect(organizer.ensureOutputReady(multipartPlan, multipartSourcePath)).resolves.toMatchObject({
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

    await expect(organizer.ensureOutputReady(invalidPlan, invalidSourcePath)).rejects.toThrow(
      "成功后不移动文件时，仅支持源目录内存在单个视频文件",
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

    await expect(organizer.ensureOutputReady(plan, fileInfo.filePath)).resolves.toMatchObject({
      targetVideoPath: join(root, "output", "FC2-123456", "FC2-123456-cd2.mp4"),
      nfoPath: join(root, "output", "FC2-123456", "FC2-123456.nfo"),
    });
  });
});

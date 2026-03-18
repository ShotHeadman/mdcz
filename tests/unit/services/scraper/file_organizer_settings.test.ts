import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { FileOrganizer } from "@main/services/scraper/FileOrganizer";
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
});

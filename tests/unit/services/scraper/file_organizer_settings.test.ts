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
    sample_images: [],
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

  it("applies subtitle/umr/leak/uncensored markers to the rendered number", () => {
    const config = createConfig({
      naming: {
        cnwordStyle: "-SUB",
        umrStyle: "-UMR",
        leakStyle: "-LEAK",
        uncensoredStyle: "-UNC",
        censoredStyle: "-CEN",
      },
    });

    const organizer = new FileOrganizer();
    const plan = organizer.plan(
      createFileInfo({
        isSubtitled: true,
      }),
      createCrawlerData({
        number: "FC2-123456",
        genres: ["流出", "破解"],
      }),
      config,
    );

    const renderedFileName = parse(plan.targetVideoPath).name;
    expect(renderedFileName).toBe("FC2-123456-SUB-UMR-LEAK-UNC");
  });

  it("applies release date formatting and max length limits", () => {
    const config = createConfig({
      naming: {
        folderTemplate: "{date}-{number}",
        fileTemplate: "{date}-{number}",
        releaseRule: "YYYY.MM.DD",
        folderNameMax: 12,
        fileNameMax: 12,
      },
    });

    const organizer = new FileOrganizer();
    const plan = organizer.plan(
      createFileInfo(),
      createCrawlerData({
        number: "ABCD-1234",
        release_date: "2024-1-2",
      }),
      config,
    );

    const folderName = parse(plan.outputDir).base;
    const renderedFileName = parse(plan.targetVideoPath).name;
    expect(folderName.startsWith("2024.01.02")).toBe(true);
    expect(renderedFileName.startsWith("2024.01.02")).toBe(true);
    expect(folderName.length).toBeLessThanOrEqual(12);
    expect(renderedFileName.length).toBeLessThanOrEqual(12);
  });

  it("keeps NFO aligned with the final video basename when rename is disabled", () => {
    const config = createConfig({
      naming: {
        folderTemplate: "{number}",
        fileTemplate: "{number}",
      },
      behavior: {
        successFileMove: true,
        successFileRename: false,
      },
    });

    const organizer = new FileOrganizer();
    const plan = organizer.plan(
      createFileInfo({
        filePath: "/input/raw-source.mp4",
        fileName: "raw-source",
      }),
      createCrawlerData({
        number: "XYZ-999",
      }),
      config,
    );

    expect(parse(plan.targetVideoPath).base).toBe("raw-source.mp4");
    expect(parse(plan.nfoPath).base).toBe("raw-source.nfo");
  });

  it("keeps local metadata beside the source video when move is disabled", () => {
    const config = createConfig({
      naming: {
        folderTemplate: "{number}",
        fileTemplate: "{number}",
      },
      behavior: {
        successFileMove: false,
        successFileRename: false,
      },
    });

    const organizer = new FileOrganizer();
    const plan = organizer.plan(
      createFileInfo({
        filePath: "/input/original-name.mp4",
        fileName: "original-name",
      }),
      createCrawlerData({
        number: "XYZ-999",
      }),
      config,
    );

    expect(plan.outputDir).toBe("/input");
    expect(plan.targetVideoPath).toBe(join("/input", "original-name.mp4"));
    expect(plan.nfoPath).toBe(join("/input", "original-name.nfo"));
  });

  it("supports renaming in place when move is disabled", () => {
    const config = createConfig({
      naming: {
        folderTemplate: "{number}",
        fileTemplate: "{number}",
      },
      behavior: {
        successFileMove: false,
        successFileRename: true,
      },
    });

    const organizer = new FileOrganizer();
    const plan = organizer.plan(
      createFileInfo({
        filePath: "/input/original-name.mp4",
        fileName: "original-name",
      }),
      createCrawlerData({
        number: "XYZ-999",
      }),
      config,
    );

    expect(plan.outputDir).toBe("/input");
    expect(plan.targetVideoPath).toBe(join("/input", "XYZ-999-CEN.mp4"));
    expect(plan.nfoPath).toBe(join("/input", "XYZ-999-CEN.nfo"));
  });

  it("resolves target collisions before writing NFO so basenames stay aligned", async () => {
    const root = await createTempDir();
    const sourcePath = join(root, "source.mp4");
    const existingTargetPath = join(root, "output", "XYZ-999-CEN", "XYZ-999-CEN.mp4");
    await writeFile(sourcePath, "video", "utf8");
    await mkdir(join(root, "output", "XYZ-999-CEN"), { recursive: true });
    await writeFile(existingTargetPath, "existing", "utf8");

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

    const plan = organizer.plan(
      createFileInfo({
        filePath: sourcePath,
        fileName: "source",
      }),
      createCrawlerData({
        number: "XYZ-999",
      }),
      config,
    );
    const prepared = await organizer.ensureOutputReady(plan, sourcePath);

    expect(prepared.targetVideoPath).toBe(join(root, "output", "XYZ-999-CEN", "XYZ-999-CEN (1).mp4"));
    expect(prepared.nfoPath).toBe(join(root, "output", "XYZ-999-CEN", "XYZ-999-CEN (1).nfo"));
  });

  it("renames in place when move is disabled but rename is enabled", async () => {
    const root = await createTempDir();
    const sourcePath = join(root, "source.mp4");
    await writeFile(sourcePath, "video", "utf8");

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

    const fileInfo = createFileInfo({
      filePath: sourcePath,
      fileName: "source",
    });
    const plan = organizer.plan(
      fileInfo,
      createCrawlerData({
        number: "XYZ-999",
      }),
      config,
    );
    const prepared = await organizer.ensureOutputReady(plan, sourcePath);
    const resultPath = await organizer.organizeVideo(fileInfo, prepared, config);

    expect(resultPath).toBe(join(root, "XYZ-999-CEN.mp4"));
    await expectPathExists(resultPath);
  });

  it("skips disk space checks when metadata stays beside the source video", async () => {
    const root = await createTempDir();
    const sourcePath = join(root, "source.mp4");
    await writeFile(sourcePath, "video", "utf8");

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

    const plan = organizer.plan(
      createFileInfo({
        filePath: sourcePath,
        fileName: "source",
      }),
      createCrawlerData({
        number: "XYZ-999",
      }),
      config,
    );

    await expect(organizer.ensureOutputReady(plan, sourcePath)).resolves.toMatchObject({
      targetVideoPath: join(root, "XYZ-999-CEN.mp4"),
      nfoPath: join(root, "XYZ-999-CEN.nfo"),
    });
    expect(diskSpaceSpy).not.toHaveBeenCalled();
  });

  it("rejects in-place scraping when the source folder contains multiple videos", async () => {
    const root = await createTempDir();
    const sourcePath = join(root, "source.mp4");
    const siblingPath = join(root, "another.mkv");
    await writeFile(sourcePath, "video", "utf8");
    await writeFile(siblingPath, "video", "utf8");

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

    const plan = organizer.plan(
      createFileInfo({
        filePath: sourcePath,
        fileName: "source",
      }),
      createCrawlerData({
        number: "XYZ-999",
      }),
      config,
    );

    await expect(organizer.ensureOutputReady(plan, sourcePath)).rejects.toThrow(
      "成功后不移动文件时，仅支持源目录内存在单个视频文件",
    );
  });

  it("ignores generated trailer sidecars when validating in-place scraping", async () => {
    const root = await createTempDir();
    const sourcePath = join(root, "source.mp4");
    const trailerPath = join(root, "trailer.mp4");
    await writeFile(sourcePath, "video", "utf8");
    await writeFile(trailerPath, "video", "utf8");

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

    const plan = organizer.plan(
      createFileInfo({
        filePath: sourcePath,
        fileName: "source",
      }),
      createCrawlerData({
        number: "XYZ-999",
      }),
      config,
    );

    await expect(organizer.ensureOutputReady(plan, sourcePath)).resolves.toMatchObject({
      targetVideoPath: join(root, "XYZ-999-CEN.mp4"),
      nfoPath: join(root, "XYZ-999-CEN.nfo"),
    });
  });
});

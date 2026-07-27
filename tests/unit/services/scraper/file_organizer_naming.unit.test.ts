import { join, parse, resolve } from "node:path";
import { buildGeneratedVideoSidecarTargetPath, FileOrganizer, isGeneratedSidecarVideo } from "@mdcz/runtime/scrape";
import { parseFileInfo } from "@mdcz/runtime/scrape/utils/number";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";
import {
  createOrganizerConfig as createConfig,
  createOrganizerCrawlerData as createCrawlerData,
  createOrganizerFileInfo as createFileInfo,
} from "./file_organizer.testSupport";

const expectedOutputPath = (...segments: string[]): string => join(resolve("/media"), "output", ...segments);

describe("FileOrganizer naming rules", () => {
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

  it("keeps slash characters inside metadata from creating nested folders", () => {
    const organizer = new FileOrganizer();
    const plan = organizer.plan(
      createFileInfo({
        filePath: "/input/source.mp4",
        fileName: "source",
      }),
      createCrawlerData({
        number: "FC2-4532163",
        title: "元标题",
        title_zh:
          "【初撮り／中出し】-sznjzpjo- しょ\\う動物系ペットショップ店員。彼氏にプレゼントを買うため、おか\\ねを稼ぐ。",
      }),
      createConfig({
        naming: {
          folderTemplate: "{actor}[{series}][{number}] {title}",
          fileTemplate: "[{series}]{number} {title}",
          folderNameMax: 255,
          fileNameMax: 255,
          censoredStyle: "",
        },
      }),
    );

    expect(plan.outputDir).toBe(
      expectedOutputPath(
        "Unknown[FC2-4532163] 【初撮り／中出し】-sznjzpjo- しょ-う動物系ペットショップ店員。彼氏にプレゼントを買うため、おか-ねを稼ぐ。",
      ),
    );
    expect(parse(plan.targetVideoPath).name).toBe(
      "FC2-4532163 【初撮り／中出し】-sznjzpjo- しょ-う動物系ペットショップ店員。彼氏にプレゼントを買うため、おか-ねを稼ぐ。",
    );
  });

  it("renders actor fallback prefixes only when the actor value falls back", () => {
    const organizer = new FileOrganizer();
    const config = createConfig({
      naming: {
        folderTemplate: "{actorFallbackPrefix}{actor}/{number}",
        fileTemplate: "{number}",
        actorFallbackToStudio: true,
        censoredStyle: "",
      },
    });

    const explicitActorPlan = organizer.plan(
      createFileInfo(),
      createCrawlerData({
        actors: ["Actor A"],
        studio: "Studio A",
      }),
      config,
    );
    expect(explicitActorPlan.outputDir).toBe(expectedOutputPath("Actor A", "ABC-123"));

    const studioFallbackPlan = organizer.plan(
      createFileInfo(),
      createCrawlerData({
        actors: [],
        studio: "Studio A",
      }),
      config,
    );
    expect(studioFallbackPlan.outputDir).toBe(expectedOutputPath("片商：Studio A", "ABC-123"));

    const sellerFallbackPlan = organizer.plan(
      createFileInfo({
        filePath: "/input/FC2-123456.mp4",
        fileName: "FC2-123456",
        number: "FC2-123456",
      }),
      createCrawlerData({
        number: "FC2-123456",
        actors: [],
        studio: "Seller A",
        publisher: "Seller A",
        website: Website.FC2,
      }),
      config,
    );
    expect(sellerFallbackPlan.outputDir).toBe(expectedOutputPath("卖家：Seller A", "FC2-123456"));

    const fc2PpvFallbackPlan = organizer.plan(
      createFileInfo({
        filePath: "/input/FC2-PPV-789012.mp4",
        fileName: "FC2-PPV-789012",
        number: "FC2-789012",
      }),
      createCrawlerData({
        number: "FC2-PPV-789012",
        actors: [],
        studio: "PPV Seller",
        website: Website.FC2,
      }),
      config,
    );
    expect(fc2PpvFallbackPlan.outputDir).toBe(expectedOutputPath("卖家：PPV Seller", "FC2-PPV-789012"));

    const publisherOnlyPlan = organizer.plan(
      createFileInfo(),
      createCrawlerData({
        actors: [],
        publisher: "Publisher Only",
      }),
      config,
    );
    expect(publisherOnlyPlan.outputDir).toBe(expectedOutputPath("Unknown", "ABC-123"));

    const disabledFallbackPlan = organizer.plan(
      createFileInfo(),
      createCrawlerData({
        actors: [],
        studio: "Studio A",
      }),
      createConfig({
        naming: {
          folderTemplate: "{actorFallbackPrefix}{actor}/{number}",
          actorFallbackToStudio: false,
          censoredStyle: "",
        },
      }),
    );
    expect(disabledFallbackPlan.outputDir).toBe(expectedOutputPath("Unknown", "ABC-123"));
  });

  it("sanitizes colon-heavy titles without turning them into nested folders", () => {
    const organizer = new FileOrganizer();
    const plan = organizer.plan(
      createFileInfo({
        filePath: "/input/source.mp4",
        fileName: "source",
      }),
      createCrawlerData({
        number: "SUJI-137",
        title: "尾行:侵入:媚薬:連れ込み:拉致輪",
        title_zh: "尾行:侵入:媚药:连れ込み:拉致輪",
        actors: ["Actor A"],
        release_date: "2026-04-08",
      }),
      createConfig({
        naming: {
          folderTemplate: "{actor}/[{date}][{number}] {title}",
          fileTemplate: "{number} {actor} {title}",
          folderNameMax: 255,
          fileNameMax: 255,
          censoredStyle: "",
        },
      }),
    );

    expect(plan.outputDir).toBe(expectedOutputPath("Actor A", "[2026-04-08][SUJI-137] 尾行-侵入-媚药-连れ込み-拉致輪"));
    expect(parse(plan.targetVideoPath).name).toBe("SUJI-137 Actor A 尾行-侵入-媚药-连れ込み-拉致輪");
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

    const fallbackPreviews = organizer.buildNamingPreview(
      createConfig({
        naming: {
          folderTemplate: "{actorFallbackPrefix}{actor}/{number}",
          fileTemplate: "{number}{originaltitle}",
          actorFallbackToStudio: true,
          censoredStyle: "",
        },
      }),
    );
    expect(fallbackPreviews.find((item) => item.label === "演员为空")?.folder).toContain("卖家：示例卖家");
    expect(fallbackPreviews.find((item) => item.label === "普通")?.file).toBe("ABC-123Sample Original Title.mp4");

    const expandedPreviews = organizer.buildNamingPreview(
      createConfig({
        naming: {
          folderTemplate:
            "{letters}/{number}/{firstActor}/{series}/{year} {director} {runtime} {definition} {filename}",
          fileTemplate:
            "{rawNumber} {allActors} {release} {firstLetter} {4K} {cnword} {censorshipType} {score} {outline} {publisher} {website}",
          cnwordStyle: "-SUB",
          censoredStyle: "",
          folderNameMax: 255,
          fileNameMax: 255,
        },
      }),
    );
    const subtitlePreview = expandedPreviews.find((item) => item.label === "中文字幕");

    expect(subtitlePreview?.folder).toContain("ABC-456-SUB");
    expect(subtitlePreview?.folder).toContain("2024 示例导演 121 2160P ABC-456");
    expect(subtitlePreview?.file).toBe("ABC-456 演员B 2024-01-15 A 4K -SUB 有码 4.5 示例简介 示例发行 dmm.mp4");
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

  it("keeps the configured Chinese subtitle marker when the source filename already has one", () => {
    const organizer = new FileOrganizer();
    const plan = organizer.plan(
      parseFileInfo("/input/ABF-252-C.mp4"),
      createCrawlerData({
        number: "ABF-252",
      }),
      createConfig({
        naming: {
          fileTemplate: "{number}",
          censoredStyle: "",
        },
      }),
    );

    expect(parse(plan.targetVideoPath).base).toBe("ABF-252-C.mp4");
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

  it("supports originaltitle in folder and file templates without replacing title", () => {
    const organizer = new FileOrganizer();
    const plan = organizer.plan(
      createFileInfo({
        filePath: "/input/source.mp4",
        fileName: "source",
      }),
      createCrawlerData({
        number: "ABC-123",
        title: "Original Title",
        title_zh: "中文标题",
        actors: ["Actor A"],
      }),
      createConfig({
        naming: {
          folderTemplate: "{actor}/{originaltitle}",
          fileTemplate: "{number} {originaltitle}",
          censoredStyle: "",
        },
      }),
    );

    expect(plan.outputDir).toBe(expectedOutputPath("Actor A", "Original Title"));
    expect(parse(plan.targetVideoPath).name).toBe("ABC-123 Original Title");
  });

  it("supports expanded MDCz naming placeholders for folders and files", () => {
    const organizer = new FileOrganizer();
    const plan = organizer.plan(
      createFileInfo({
        filePath: "/input/raw-source.mp4",
        fileName: "raw-source",
        isSubtitled: true,
        subtitleTag: "中文字幕",
        resolution: "2160P",
      }),
      createCrawlerData({
        number: "ABC-123",
        title: "Original Title",
        title_zh: "中文标题",
        actors: ["Actor A", "Actor B"],
        director: "Director A",
        series: "Series A",
        studio: "Studio A",
        publisher: "Publisher A",
        release_date: "2024-01-02",
        durationSeconds: 7260,
        rating: 4.5,
        plot: "Original plot",
        plot_zh: "中文简介",
      }),
      createConfig({
        naming: {
          folderTemplate:
            "{letters}/{number}/{firstActor}/{series}/{year} {director} {runtime} {definition} {filename}",
          fileTemplate: "{number} {allActors} {release} {firstLetter} {4K} {cnword} {censorshipType} {score} {outline}",
          cnwordStyle: "-SUB",
          censoredStyle: "",
          folderNameMax: 255,
          fileNameMax: 255,
        },
      }),
    );

    expect(plan.outputDir).toBe(
      expectedOutputPath("ABC", "ABC-123-SUB", "Actor A", "Series A", "2024 Director A 121 2160P raw-source"),
    );
    expect(parse(plan.targetVideoPath).name).toBe("ABC-123-SUB Actor A Actor B 2024-01-02 A 4K -SUB 有码 4.5 中文简介");
  });
});

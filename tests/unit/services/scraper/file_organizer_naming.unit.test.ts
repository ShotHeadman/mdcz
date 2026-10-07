import { join, parse, resolve } from "node:path";
import { buildGeneratedVideoSidecarTargetPath, FileOrganizer, isPrimaryVideoFile } from "@mdcz/runtime/scrape";
import { parseFileInfo } from "@mdcz/runtime/scrape/utils/number";
import { Website } from "@mdcz/shared/enums";
import type { PlacementMode } from "@mdcz/shared/mediaLibrary";
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
          target: { folderTemplate: "{date}-{number}", fileTemplate: "{date}-{number}" },
          naming: {
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
          target: { folderTemplate: "{studio}/{number}", fileTemplate: "{studio} - {number}" },
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
      assert(organizer.plan(fileInfo, crawlerData, ...config));
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
      ...createConfig({
        target: { folderTemplate: "{actor}[{series}][{number}] {title}", fileTemplate: "[{series}]{number} {title}" },
        naming: {
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
      target: { folderTemplate: "{actorFallbackPrefix}{actor}/{number}", fileTemplate: "{number}" },
      naming: {
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
      ...config,
    );
    expect(explicitActorPlan.outputDir).toBe(expectedOutputPath("Actor A", "ABC-123"));

    const studioFallbackPlan = organizer.plan(
      createFileInfo(),
      createCrawlerData({
        actors: [],
        studio: "Studio A",
      }),
      ...config,
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
      ...config,
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
      ...config,
    );
    expect(fc2PpvFallbackPlan.outputDir).toBe(expectedOutputPath("卖家：PPV Seller", "FC2-PPV-789012"));

    const publisherOnlyPlan = organizer.plan(
      createFileInfo(),
      createCrawlerData({
        actors: [],
        publisher: "Publisher Only",
      }),
      ...config,
    );
    expect(publisherOnlyPlan.outputDir).toBe(expectedOutputPath("Unknown", "ABC-123"));

    const disabledFallbackPlan = organizer.plan(
      createFileInfo(),
      createCrawlerData({
        actors: [],
        studio: "Studio A",
      }),
      ...createConfig({
        target: { folderTemplate: "{actorFallbackPrefix}{actor}/{number}" },
        naming: {
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
      ...createConfig({
        target: { folderTemplate: "{actor}/[{date}][{number}] {title}", fileTemplate: "{number} {actor} {title}" },
        naming: {
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
      ...createConfig({
        target: { fileTemplate: "{number}" },
        naming: {
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
      ...createConfig({
        target: { fileTemplate: "{number}" },
        naming: {
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
      ...createConfig({
        naming: {
          cnwordStyle: "-SUB",
          umrStyle: "-UMR",
          leakStyle: "-LEAK",
          censoredStyle: "-CEN",
        },
      }),
    );

    expect(previews.find((item) => item.sample === "subtitled")?.file).toContain("-SUB");
    expect(previews.find((item) => item.sample === "multiActor")?.folder).toContain("等演员");

    const fallbackPreviews = organizer.buildNamingPreview(
      ...createConfig({
        target: { folderTemplate: "{actorFallbackPrefix}{actor}/{number}", fileTemplate: "{number}{originaltitle}" },
        naming: {
          actorFallbackToStudio: true,
          censoredStyle: "",
        },
      }),
    );
    expect(fallbackPreviews.find((item) => item.sample === "noActor")?.folder).toContain("卖家：示例卖家");
    expect(fallbackPreviews.find((item) => item.sample === "standard")?.file).toBe("ABC-123Sample Original Title.mp4");

    const expandedPreviews = organizer.buildNamingPreview(
      ...createConfig({
        target: {
          folderTemplate:
            "{letters}/{number}/{firstActor}/{series}/{year} {director} {runtime} {definition} {filename}",
          fileTemplate:
            "{rawNumber} {allActors} {release} {firstLetter} {4K} {cnword} {censorshipType} {score} {outline} {publisher} {website}",
        },
        naming: {
          cnwordStyle: "-SUB",
          censoredStyle: "",
          folderNameMax: 255,
          fileNameMax: 255,
        },
      }),
    );
    const subtitlePreview = expandedPreviews.find((item) => item.sample === "subtitled");

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
      ...createConfig({
        target: { fileTemplate: "{number}" },
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
      ...createConfig({
        target: { fileTemplate: "{number}" },
        naming: {
          censoredStyle: "",
        },
      }),
    );

    expect(parse(plan.targetVideoPath).base).toBe("ABF-252-C.mp4");
  });

  it("keeps video and NFO basenames aligned for moved and in-place libraries", () => {
    const organizer = new FileOrganizer();
    const source = createFileInfo({ filePath: join(resolve("/input"), "raw-source.mp4"), fileName: "raw-source" });
    const data = createCrawlerData({ number: "XYZ-999" });

    const kept = organizer.plan(
      source,
      data,
      ...createConfig({ target: { folderTemplate: "{number}", fileTemplate: "{filename}" } }),
    );
    expect(kept.targetVideoPath).toBe(expectedOutputPath("XYZ-999-CEN", "raw-source.mp4"));
    expect(parse(kept.nfoPath).base).toBe("raw-source.nfo");

    const inPlace = organizer.plan(source, data, ...createConfig({ target: { placement: "inPlace", outputPath: "" } }));
    expect(inPlace).toMatchObject({
      mode: "preserve",
      outputDir: resolve("/input"),
      targetVideoPath: source.filePath,
      nfoPath: join(resolve("/input"), "raw-source.nfo"),
    });
  });

  it("identifies generated FC2 sidecars and builds paths from the shared movie base name", () => {
    const names = [
      "FC2-123456_gift.mp4",
      "[Thz.la]fc2-ppv-1234567-特典.mp4",
      "FC2-PPV-1234567 メイキング2.mp4",
      "FC2-PPV-1234567 素人初撮り-おまけ.mp4",
      "FC2-PPV-1234567 【特典あり】素人初撮り.mp4",
      "FC2-PPV-1234567 ※レビュー特典あり 完全版.mp4",
      "FC2-PPV-1234567 おまけ付き.mp4",
      "FC2-PPV-1234567 誕生日gift企画.mp4",
      "SNOS-301-特典.mp4",
    ];
    expect(Object.fromEntries(names.map((name) => [name, isPrimaryVideoFile(name.normalize("NFD"))]))).toEqual({
      "FC2-123456_gift.mp4": false,
      "[Thz.la]fc2-ppv-1234567-特典.mp4": false,
      "FC2-PPV-1234567 メイキング2.mp4": false,
      "FC2-PPV-1234567 素人初撮り-おまけ.mp4": false,
      "FC2-PPV-1234567 【特典あり】素人初撮り.mp4": true,
      "FC2-PPV-1234567 ※レビュー特典あり 完全版.mp4": true,
      "FC2-PPV-1234567 おまけ付き.mp4": true,
      "FC2-PPV-1234567 誕生日gift企画.mp4": true,
      "SNOS-301-特典.mp4": true,
    });
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
      ...createConfig({
        target: { folderTemplate: "{actor}/{originaltitle}", fileTemplate: "{number} {originaltitle}" },
        naming: {
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
      ...createConfig({
        target: {
          folderTemplate:
            "{letters}/{number}/{firstActor}/{series}/{year} {director} {runtime} {definition} {filename}",
          fileTemplate: "{number} {allActors} {release} {firstLetter} {4K} {cnword} {censorshipType} {score} {outline}",
        },
        naming: {
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

  it("places media by the library's placement: transfers, links, or metadata beside the untouched source", () => {
    const organizer = new FileOrganizer();
    const source = createFileInfo({ filePath: join(resolve("/input"), "raw-source.mp4"), fileName: "raw-source" });
    const data = createCrawlerData({ number: "XYZ-999", actors: ["Actor"] });
    const folder = expectedOutputPath("Actor", "XYZ-999-CEN");
    const plan = (placement: PlacementMode) => organizer.plan(source, data, ...createConfig({ target: { placement } }));

    for (const transfer of ["move", "hardlink", "copy"] as const) {
      expect(plan(transfer)).toMatchObject({
        mode: "move",
        transfer,
        targetVideoPath: join(folder, "XYZ-999-CEN.mp4"),
      });
    }
    expect(plan("symlink")).toMatchObject({
      mode: "preserve",
      targetVideoPath: source.filePath,
      link: { kind: "symlink", path: join(folder, "XYZ-999-CEN.mp4") },
      nfoPath: join(folder, "XYZ-999-CEN.nfo"),
    });
    expect(plan("strm").link).toEqual({ kind: "strm", path: join(folder, "XYZ-999-CEN.strm") });
    expect(plan("metadataOnly")).toMatchObject({
      mode: "preserve",
      targetVideoPath: source.filePath,
      metadataDir: folder,
    });
    expect(plan("metadataOnly").link).toBeUndefined();
    expect(() =>
      organizer.plan(
        source,
        data,
        ...createConfig({ target: { placement: "symlink", outputPath: resolve("/input") } }),
      ),
    ).toThrow("cannot be the same as or contain");
  });
});

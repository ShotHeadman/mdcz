import { Website } from "@shared/enums";
import type { CrawlerData, FieldDiff, LocalScanEntry, MaintenancePreviewItem } from "@shared/types";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCommittedCrawlerData,
  buildMaintenanceCommitItem,
  resolveMaintenanceDiffImageOption,
  resolveMaintenanceDiffImageSrc,
} from "@/lib/maintenance";
import {
  buildMaintenanceEntryGroups,
  buildMaintenanceEntryViewModel,
  countMaintenanceDisplayItems,
  findMaintenanceEntryGroup,
  formatMaintenanceIdleStatusText,
  summarizeMaintenanceExecutionGroups,
  summarizeMaintenancePreviewGroups,
} from "@/lib/maintenanceGrouping";
import { useMaintenanceEntryStore } from "@/store/maintenanceEntryStore";
import { useMaintenanceExecutionStore } from "@/store/maintenanceExecutionStore";
import { useMaintenancePreviewStore } from "@/store/maintenancePreviewStore";
import {
  applyMaintenanceExecutionItemResult,
  applyMaintenancePreviewResult,
  cancelMaintenancePreviewFlow,
  changeMaintenancePreset,
  clearMaintenancePreviewResults,
  invalidateMaintenancePreview,
  toggleMaintenanceSelectedIds,
} from "@/store/maintenanceSession";

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Old Title",
  title_zh: "旧标题",
  number: "ABC-123",
  actors: ["Actor A"],
  genres: ["Drama"],
  scene_images: ["https://example.com/old-scene.jpg"],
  website: Website.DMM,
  ...overrides,
});

const createEntry = (crawlerData?: CrawlerData): LocalScanEntry => ({
  fileId: "entry-1",
  fileInfo: {
    filePath: "/media/ABC-123.mp4",
    fileName: "ABC-123.mp4",
    extension: ".mp4",
    number: "ABC-123",
    isSubtitled: false,
  },
  nfoPath: "/media/ABC-123.nfo",
  crawlerData,
  assets: {
    poster: "/media/poster.jpg",
    thumb: "/media/thumb.jpg",
    fanart: "/media/fanart.jpg",
    sceneImages: ["/media/extrafanart/fanart1.jpg"],
    trailer: "/media/trailer.mp4",
    actorPhotos: ["/media/.actors/Actor A.jpg"],
  },
  currentDir: "/media",
  groupingDirectory: "/media",
});

type ValueDiffInput = Omit<Extract<FieldDiff, { kind: "value" }>, "kind">;
type ImageDiffInput = Omit<Extract<FieldDiff, { kind: "image" }>, "kind">;
type ImageCollectionDiffInput = Omit<Extract<FieldDiff, { kind: "imageCollection" }>, "kind">;

const createValueDiff = (overrides: ValueDiffInput): FieldDiff => ({
  kind: "value",
  ...overrides,
});

const createImageDiff = (overrides: ImageDiffInput): FieldDiff => ({
  kind: "image",
  ...overrides,
});

const createImageCollectionDiff = (overrides: ImageCollectionDiffInput): FieldDiff => ({
  kind: "imageCollection",
  ...overrides,
});

afterEach(() => {
  useMaintenancePreviewStore.getState().reset();
  useMaintenanceExecutionStore.getState().reset();
  useMaintenanceEntryStore.getState().reset();
});

describe("maintenance multipart grouping", () => {
  it("collapses same-directory multipart files into one display group", () => {
    const part1: LocalScanEntry = {
      ...createEntry(createCrawlerData({ number: "FC2-123456" })),
      fileId: "entry-1",
      fileInfo: {
        filePath: "/media/FC2-123456-1.mp4",
        fileName: "FC2-123456-1",
        extension: ".mp4",
        number: "FC2-123456",
        isSubtitled: false,
        part: {
          number: 1,
          suffix: "-1",
        },
      },
      currentDir: "/media",
    };
    const part2: LocalScanEntry = {
      ...part1,
      fileId: "entry-2",
      fileInfo: {
        ...part1.fileInfo,
        filePath: "/media/FC2-123456-2.mp4",
        fileName: "FC2-123456-2",
        part: {
          number: 2,
          suffix: "-2",
        },
      },
    };
    const standalone: LocalScanEntry = {
      ...createEntry(createCrawlerData({ number: "ABC-123" })),
      fileId: "entry-3",
    };

    const groups = buildMaintenanceEntryGroups([part2, standalone, part1]);

    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.representative.fileId === "entry-3")).toMatchObject({
      representative: standalone,
    });
    expect(groups.find((group) => group.items.length === 2)?.items.map((entry) => entry.fileId)).toEqual([
      "entry-1",
      "entry-2",
    ]);
    expect(formatMaintenanceIdleStatusText([part1, part2])).toBe("已扫描 1 项");
  });

  it("uses the same same-directory same-number grouping rule as normal scrape results", () => {
    const first: LocalScanEntry = {
      ...createEntry(createCrawlerData({ number: "ABC-123" })),
      fileId: "entry-a",
      fileInfo: {
        filePath: "/media/ABC-123-copy-a.mp4",
        fileName: "ABC-123-copy-a.mp4",
        extension: ".mp4",
        number: "ABC-123",
        isSubtitled: false,
      },
      currentDir: "/media",
    };
    const second: LocalScanEntry = {
      ...first,
      fileId: "entry-b",
      fileInfo: {
        ...first.fileInfo,
        filePath: "/media/ABC-123-copy-b.mp4",
        fileName: "ABC-123-copy-b.mp4",
      },
    };

    const groups = buildMaintenanceEntryGroups([first, second]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((entry) => entry.fileId)).toEqual(["entry-a", "entry-b"]);
  });

  it("derives grouped status and error text from child maintenance results", () => {
    const part1: LocalScanEntry = {
      ...createEntry(),
      fileId: "entry-1",
      fileInfo: {
        ...createEntry().fileInfo,
        number: "FC2-123456",
        part: {
          number: 1,
          suffix: "-1",
        },
      },
      currentDir: "/media",
    };
    const part2: LocalScanEntry = {
      ...part1,
      fileId: "entry-2",
      scanError: "NFO 解析失败",
      fileInfo: {
        ...part1.fileInfo,
        filePath: "/media/FC2-123456-2.mp4",
        fileName: "FC2-123456-2",
        part: {
          number: 2,
          suffix: "-2",
        },
      },
    };

    const itemResults = {
      "entry-1": {
        fileId: "entry-1",
        status: "success" as const,
      },
      "entry-2": {
        fileId: "entry-2",
        status: "failed" as const,
        error: "维护失败",
      },
    };

    const [group] = buildMaintenanceEntryGroups([part1, part2], { itemResults });
    expect(group).toBeDefined();

    if (!group) {
      throw new Error("Expected multipart group");
    }

    expect(group.status).toBe("failed");
    expect(group.errorText).toBe("维护失败");
    expect(group.compareResult).toMatchObject({
      fileId: "entry-2",
      status: "failed",
      error: "维护失败",
    });
  });

  it("marks the whole group as failed immediately when any child file fails", () => {
    const part1: LocalScanEntry = {
      ...createEntry(),
      fileId: "entry-1",
      fileInfo: {
        ...createEntry().fileInfo,
        number: "FC2-123456",
        part: {
          number: 1,
          suffix: "-1",
        },
      },
      currentDir: "/media",
    };
    const part2: LocalScanEntry = {
      ...part1,
      fileId: "entry-2",
      fileInfo: {
        ...part1.fileInfo,
        filePath: "/media/FC2-123456-2.mp4",
        fileName: "FC2-123456-2",
        part: {
          number: 2,
          suffix: "-2",
        },
      },
    };

    const [group] = buildMaintenanceEntryGroups([part1, part2], {
      itemResults: {
        "entry-1": {
          fileId: "entry-1",
          status: "processing",
        },
        "entry-2": {
          fileId: "entry-2",
          status: "failed",
          error: "第二个分盘维护失败",
        },
      },
    });

    expect(group?.status).toBe("failed");
    expect(group?.errorText).toBe("第二个分盘维护失败");
    expect(group?.compareResult).toMatchObject({
      fileId: "entry-2",
      status: "failed",
      error: "第二个分盘维护失败",
    });
  });

  it("summarizes preview counts by grouped movie instead of raw file count", () => {
    const part1: LocalScanEntry = {
      ...createEntry(),
      fileId: "entry-1",
      fileInfo: {
        ...createEntry().fileInfo,
        number: "FC2-123456",
        part: {
          number: 1,
          suffix: "-1",
        },
      },
      currentDir: "/media",
    };
    const part2: LocalScanEntry = {
      ...part1,
      fileId: "entry-2",
      fileInfo: {
        ...part1.fileInfo,
        filePath: "/media/FC2-123456-2.mp4",
        fileName: "FC2-123456-2",
        part: {
          number: 2,
          suffix: "-2",
        },
      },
    };

    expect(
      summarizeMaintenancePreviewGroups([part1, part2], {
        "entry-1": {
          fileId: "entry-1",
          status: "ready",
        },
        "entry-2": {
          fileId: "entry-2",
          status: "ready",
        },
      }),
    ).toEqual({
      totalCount: 1,
      readyCount: 1,
      blockedCount: 0,
    });
  });

  it("treats a ready preview as the effective status when local scanError has been recovered", () => {
    const entry: LocalScanEntry = {
      ...createEntry(),
      scanError: "NFO 解析失败: NFO missing website",
      crawlerData: undefined,
    };

    const [group] = buildMaintenanceEntryGroups([entry], {
      previewResults: {
        [entry.fileId]: {
          fileId: entry.fileId,
          status: "ready",
        },
      },
    });

    expect(group?.status).toBe("success");
    expect(group?.errorText).toBeUndefined();
  });

  it("builds a unified batch view model with grouped preview state and executable entries", () => {
    const part1: LocalScanEntry = {
      ...createEntry(),
      fileId: "entry-1",
      fileInfo: {
        ...createEntry().fileInfo,
        number: "FC2-123456",
        part: {
          number: 1,
          suffix: "-1",
        },
      },
      currentDir: "/media",
    };
    const part2: LocalScanEntry = {
      ...part1,
      fileId: "entry-2",
      fileInfo: {
        ...part1.fileInfo,
        filePath: "/media/FC2-123456-2.mp4",
        fileName: "FC2-123456-2",
        part: {
          number: 2,
          suffix: "-2",
        },
      },
    };

    const viewModel = buildMaintenanceEntryViewModel([part1, part2], {
      previewResults: {
        "entry-1": {
          fileId: "entry-1",
          status: "ready",
          fieldDiffs: [createValueDiff({ field: "title", label: "标题", oldValue: "A", newValue: "B", changed: true })],
          pathDiff: {
            fileId: "entry-1",
            currentVideoPath: "/media/FC2-123456-1.mp4",
            targetVideoPath: "/organized/FC2-123456-1.mp4",
            currentDir: "/media",
            targetDir: "/organized",
            changed: true,
          },
        },
        "entry-2": {
          fileId: "entry-2",
          status: "ready",
        },
      },
    });

    expect(viewModel.previewSummary).toEqual({
      totalCount: 1,
      readyCount: 1,
      blockedCount: 0,
    });
    expect(viewModel.executableEntries.map((entry) => entry.fileId)).toEqual(["entry-1", "entry-2"]);
    expect(viewModel.groups[0]?.previewState).toMatchObject({
      ready: true,
      diffCount: 1,
      hasPathChange: true,
    });
  });

  it("summarizes execution counts by grouped movie instead of raw file count", () => {
    const part1: LocalScanEntry = {
      ...createEntry(),
      fileId: "entry-1",
      fileInfo: {
        ...createEntry().fileInfo,
        number: "FC2-123456",
        part: {
          number: 1,
          suffix: "-1",
        },
      },
      currentDir: "/media",
    };
    const part2: LocalScanEntry = {
      ...part1,
      fileId: "entry-2",
      fileInfo: {
        ...part1.fileInfo,
        filePath: "/media/FC2-123456-2.mp4",
        fileName: "FC2-123456-2",
        part: {
          number: 2,
          suffix: "-2",
        },
      },
    };

    expect(
      summarizeMaintenanceExecutionGroups([part1, part2], {
        "entry-1": {
          fileId: "entry-1",
          status: "success",
        },
        "entry-2": {
          fileId: "entry-2",
          status: "success",
        },
      }),
    ).toEqual({
      totalCount: 1,
      completedCount: 1,
      successCount: 1,
      failedCount: 0,
      activeCount: 0,
    });
  });

  it("keeps multipart groups stable while a child entry has already moved to the target directory", () => {
    const sourceDir = "/media";
    const targetDir = "/organized/FC2-123456";
    const part1: LocalScanEntry = {
      ...createEntry(),
      fileId: "entry-1",
      currentDir: targetDir,
      fileInfo: {
        ...createEntry().fileInfo,
        filePath: `${targetDir}/FC2-123456-1.mp4`,
        fileName: "FC2-123456-1",
        number: "FC2-123456",
        part: {
          number: 1,
          suffix: "-1",
        },
      },
    };
    const part2: LocalScanEntry = {
      ...createEntry(),
      fileId: "entry-2",
      currentDir: sourceDir,
      fileInfo: {
        ...createEntry().fileInfo,
        filePath: `${sourceDir}/FC2-123456-2.mp4`,
        fileName: "FC2-123456-2",
        number: "FC2-123456",
        part: {
          number: 2,
          suffix: "-2",
        },
      },
    };
    const itemResults = {
      "entry-1": {
        fileId: "entry-1",
        status: "success" as const,
        pathDiff: {
          fileId: "entry-1",
          currentVideoPath: `${sourceDir}/FC2-123456-1.mp4`,
          targetVideoPath: `${targetDir}/FC2-123456-1.mp4`,
          currentDir: sourceDir,
          targetDir,
          changed: true,
        },
      },
      "entry-2": {
        fileId: "entry-2",
        status: "processing" as const,
        pathDiff: {
          fileId: "entry-2",
          currentVideoPath: `${sourceDir}/FC2-123456-2.mp4`,
          targetVideoPath: `${targetDir}/FC2-123456-2.mp4`,
          currentDir: sourceDir,
          targetDir,
          changed: true,
        },
      },
    };

    expect(countMaintenanceDisplayItems([part1, part2], { itemResults })).toBe(1);
    expect(buildMaintenanceEntryGroups([part1, part2], { itemResults })).toHaveLength(1);
  });

  it("finds a grouped entry by any child entry id", () => {
    const first: LocalScanEntry = {
      ...createEntry(createCrawlerData({ number: "ABC-123" })),
      fileId: "entry-a",
      fileInfo: {
        filePath: "/media/ABC-123-part1.mp4",
        fileName: "ABC-123-part1.mp4",
        extension: ".mp4",
        number: "ABC-123",
        isSubtitled: false,
      },
      currentDir: "/media",
    };
    const second: LocalScanEntry = {
      ...first,
      fileId: "entry-b",
      fileInfo: {
        ...first.fileInfo,
        filePath: "/media/ABC-123-part2.mp4",
        fileName: "ABC-123-part2.mp4",
      },
    };

    const group = findMaintenanceEntryGroup([first, second], "entry-b");

    expect(group?.id).toBe("/media::ABC-123");
    expect(group?.representative.fileId).toBe("entry-a");
    expect(group?.items.map((entry) => entry.fileId)).toEqual(["entry-a", "entry-b"]);
  });
});

describe("buildCommittedCrawlerData", () => {
  it("merges selected old and new diff values onto the existing crawler data", () => {
    const entry = createEntry(createCrawlerData());
    const preview: MaintenancePreviewItem = {
      fileId: entry.fileId,
      status: "ready",
      proposedCrawlerData: createCrawlerData({
        title: "New Title",
        title_zh: "新标题",
        genres: ["Drama", "Mystery"],
      }),
      fieldDiffs: [
        createValueDiff({ field: "title", label: "标题", oldValue: "Old Title", newValue: "New Title", changed: true }),
        createValueDiff({
          field: "title_zh",
          label: "中文标题",
          oldValue: "旧标题",
          newValue: "新标题",
          changed: true,
        }),
        createValueDiff({
          field: "genres",
          label: "标签",
          oldValue: ["Drama"],
          newValue: ["Drama", "Mystery"],
          changed: true,
        }),
      ],
    };

    const committed = buildCommittedCrawlerData(entry, preview, {
      title: "old",
      title_zh: "new",
      genres: "new",
    });

    expect(committed).toMatchObject({
      title: "Old Title",
      title_zh: "新标题",
      genres: ["Drama", "Mystery"],
      number: "ABC-123",
    });
  });
});

describe("buildMaintenanceCommitItem", () => {
  it("keeps only selected preview image alternatives and derives asset decisions from the chosen side", () => {
    const entry = createEntry(
      createCrawlerData({
        poster_url: "https://example.com/old-poster.jpg",
        thumb_url: "https://example.com/old-thumb.jpg",
        poster_source_url: "https://example.com/old-poster.jpg",
        thumb_source_url: "https://example.com/old-thumb.jpg",
      }),
    );
    const preview: MaintenancePreviewItem = {
      fileId: entry.fileId,
      status: "ready",
      proposedCrawlerData: createCrawlerData({
        poster_url: "https://example.com/new-poster.jpg",
        thumb_url: "https://example.com/new-thumb.jpg",
      }),
      imageAlternatives: {
        poster_url: ["https://example.com/poster-alt.jpg"],
        thumb_url: ["https://example.com/thumb-alt.jpg"],
      },
      fieldDiffs: [
        createImageDiff({
          field: "poster_url",
          label: "海报",
          oldValue: "https://example.com/old-poster.jpg",
          newValue: "https://example.com/new-poster.jpg",
          changed: true,
          oldPreview: {
            src: "/media/poster.jpg",
            fallbackSrcs: [],
          },
          newPreview: {
            src: "https://example.com/new-poster.jpg",
            fallbackSrcs: ["https://example.com/poster-alt.jpg"],
          },
        }),
        createImageDiff({
          field: "thumb_url",
          label: "封面图",
          oldValue: "https://example.com/old-thumb.jpg",
          newValue: "https://example.com/new-thumb.jpg",
          changed: true,
          oldPreview: {
            src: "/media/thumb.jpg",
            fallbackSrcs: [],
          },
          newPreview: {
            src: "https://example.com/new-thumb.jpg",
            fallbackSrcs: ["https://example.com/thumb-alt.jpg"],
          },
        }),
      ],
    };

    const item = buildMaintenanceCommitItem(entry, preview, {
      poster_url: "old",
      thumb_url: "new",
    });

    expect(item.crawlerData?.poster_url).toBe("https://example.com/old-poster.jpg");
    expect(item.crawlerData?.thumb_url).toBe("https://example.com/new-thumb.jpg");
    expect(item.crawlerData?.fanart_url).toBeUndefined();
    expect(item.crawlerData?.poster_source_url).toBe("https://example.com/old-poster.jpg");
    expect(item.crawlerData?.thumb_source_url).toBe("https://example.com/new-thumb.jpg");
    expect(item.crawlerData?.fanart_source_url).toBe("https://example.com/new-thumb.jpg");
    expect(item.imageAlternatives).toEqual({
      thumb_url: ["https://example.com/thumb-alt.jpg"],
    });
    expect(item.assetDecisions).toEqual({
      fanart: "replace",
    });

    const sceneEntry = createEntry(
      createCrawlerData({
        scene_images: [],
      }),
    );
    const scenePreview: MaintenancePreviewItem = {
      fileId: sceneEntry.fileId,
      status: "ready",
      proposedCrawlerData: createCrawlerData({
        scene_images: ["https://example.com/new-scene.jpg"],
      }),
      fieldDiffs: [
        createImageCollectionDiff({
          field: "scene_images",
          label: "剧照",
          oldValue: [],
          newValue: ["https://example.com/new-scene.jpg"],
          changed: true,
          oldPreview: {
            items: ["/media/extrafanart/fanart1.jpg"],
          },
          newPreview: {
            items: ["https://example.com/new-scene.jpg"],
          },
        }),
      ],
    };

    const sceneItem = buildMaintenanceCommitItem(sceneEntry, scenePreview, {
      scene_images: "old",
    });

    expect(sceneItem.crawlerData?.scene_images).toEqual([]);
    expect(sceneItem.assetDecisions).toEqual({
      sceneImages: "preserve",
    });

    const remoteEntry = createEntry(
      createCrawlerData({
        trailer_url: "https://example.com/trailer-old.mp4",
        trailer_source_url: "https://example.com/trailer-old.mp4",
      }),
    );
    const remotePreview: MaintenancePreviewItem = {
      fileId: remoteEntry.fileId,
      status: "ready",
      proposedCrawlerData: createCrawlerData({
        trailer_url: "https://example.com/trailer-new.mp4",
        trailer_source_url: "https://example.com/trailer-new.mp4",
      }),
      fieldDiffs: [
        createValueDiff({
          field: "trailer_url",
          label: "预告片",
          oldValue: "https://example.com/trailer-old.mp4",
          newValue: "https://example.com/trailer-new.mp4",
          changed: true,
        }),
      ],
    };

    const replacedTrailer = buildMaintenanceCommitItem(remoteEntry, remotePreview, {
      trailer_url: "new",
    });

    expect(replacedTrailer.crawlerData?.trailer_url).toBe("https://example.com/trailer-new.mp4");
    expect(replacedTrailer.crawlerData?.trailer_source_url).toBe("https://example.com/trailer-new.mp4");
    expect(replacedTrailer.assetDecisions).toEqual({
      trailer: "replace",
    });

    const localEntry: LocalScanEntry = {
      ...createEntry(),
      scanError: "NFO 解析失败: NFO missing website",
    };
    const localPreview: MaintenancePreviewItem = {
      fileId: localEntry.fileId,
      status: "ready",
      proposedCrawlerData: createCrawlerData({
        trailer_url: "https://example.com/trailer-new.mp4",
        trailer_source_url: "https://example.com/trailer-new.mp4",
      }),
      fieldDiffs: [
        createValueDiff({
          field: "trailer_url",
          label: "预告片",
          oldValue: "trailer.mp4",
          newValue: "https://example.com/trailer-new.mp4",
          changed: true,
        }),
      ],
    };

    const preservedTrailer = buildMaintenanceCommitItem(localEntry, localPreview, {
      trailer_url: "old",
    });

    expect(preservedTrailer.crawlerData?.trailer_url).toBe("trailer.mp4");
    expect(preservedTrailer.crawlerData?.trailer_source_url).toBeUndefined();
    expect(preservedTrailer.assetDecisions).toEqual({
      trailer: "preserve",
    });
  });

  it("replays selected local poster and thumb assets when NFO parsing failed", () => {
    const entry: LocalScanEntry = {
      ...createEntry(),
      scanError: "NFO 解析失败: NFO missing website",
    };
    const preview: MaintenancePreviewItem = {
      fileId: entry.fileId,
      status: "ready",
      proposedCrawlerData: createCrawlerData({
        poster_url: "https://example.com/new-poster.jpg",
        poster_source_url: "https://example.com/new-poster.jpg",
        thumb_url: "https://example.com/new-thumb.jpg",
        thumb_source_url: "https://example.com/new-thumb.jpg",
        fanart_source_url: "https://example.com/new-thumb.jpg",
      }),
      fieldDiffs: [
        createImageDiff({
          field: "poster_url",
          label: "海报",
          oldValue: "",
          newValue: "https://example.com/new-poster.jpg",
          changed: true,
          oldPreview: {
            src: "/media/poster.jpg",
            fallbackSrcs: [],
          },
          newPreview: {
            src: "https://example.com/new-poster.jpg",
            fallbackSrcs: [],
          },
        }),
        createImageDiff({
          field: "thumb_url",
          label: "封面图",
          oldValue: "",
          newValue: "https://example.com/new-thumb.jpg",
          changed: true,
          oldPreview: {
            src: "/media/thumb.jpg",
            fallbackSrcs: [],
          },
          newPreview: {
            src: "https://example.com/new-thumb.jpg",
            fallbackSrcs: [],
          },
        }),
      ],
    };

    const item = buildMaintenanceCommitItem(entry, preview, {
      poster_url: "old",
      thumb_url: "old",
    });

    expect(item.crawlerData?.poster_url).toBe("poster.jpg");
    expect(item.crawlerData?.thumb_url).toBe("thumb.jpg");
    expect(item.crawlerData?.poster_source_url).toBeUndefined();
    expect(item.crawlerData?.thumb_source_url).toBeUndefined();
    expect(item.crawlerData?.fanart_url).toBeUndefined();
    expect(item.crawlerData?.fanart_source_url).toBeUndefined();
    expect(item.assetDecisions).toEqual({
      fanart: "preserve",
    });
  });
});

describe("resolveMaintenanceDiffImageSrc", () => {
  it("prefers discovered local artwork and falls back to thumb-based fanart previews", () => {
    const posterDiff = createImageDiff({
      field: "poster_url",
      label: "海报",
      oldValue: "poster.jpg",
      newValue: "https://example.com/new-poster.jpg",
      changed: true,
      oldPreview: {
        src: "/media/poster.jpg",
        fallbackSrcs: [],
      },
      newPreview: {
        src: "https://example.com/new-poster.jpg",
        fallbackSrcs: [],
      },
    });

    expect(resolveMaintenanceDiffImageSrc(posterDiff, "old")).toBe("/media/poster.jpg");
    expect(resolveMaintenanceDiffImageSrc(posterDiff, "new")).toBe("https://example.com/new-poster.jpg");

    const fanartDiff = createImageDiff({
      field: "fanart_url",
      label: "背景图",
      oldValue: undefined,
      newValue: "https://example.com/new-fanart.jpg",
      changed: true,
      oldPreview: {
        src: "/media/fanart.jpg",
        fallbackSrcs: [],
      },
      newPreview: {
        src: "https://example.com/new-fanart.jpg",
        fallbackSrcs: [],
      },
    });

    expect(resolveMaintenanceDiffImageSrc(fanartDiff, "old")).toBe("/media/fanart.jpg");

    const thumbFallbackDiff = createImageDiff({
      field: "fanart_url",
      label: "背景图",
      oldValue: undefined,
      newValue: undefined,
      changed: true,
      oldPreview: {
        src: "/media/thumb.jpg",
        fallbackSrcs: [],
      },
      newPreview: {
        src: "https://example.com/new-thumb.jpg",
        fallbackSrcs: ["https://example.com/new-thumb-alt.jpg"],
      },
    });

    expect(resolveMaintenanceDiffImageOption(thumbFallbackDiff, "old")).toEqual({
      src: "/media/thumb.jpg",
      fallbackSrcs: [],
    });
    expect(resolveMaintenanceDiffImageOption(thumbFallbackDiff, "new")).toEqual({
      src: "https://example.com/new-thumb.jpg",
      fallbackSrcs: ["https://example.com/new-thumb-alt.jpg"],
    });
  });
});

describe("maintenance execution stores", () => {
  it("preserves preview diffs during optimistic execution and can roll back execution state", () => {
    const fieldDiff = createValueDiff({
      field: "title" as const,
      label: "标题",
      oldValue: "Old Title",
      newValue: "New Title",
      changed: true,
    });
    const unchangedFieldDiff = createValueDiff({
      field: "actors" as const,
      label: "演员",
      oldValue: ["Actor A"],
      newValue: ["Actor A"],
      changed: false,
    });
    const pathDiff = {
      fileId: "entry-1",
      currentVideoPath: "/media/ABC-123.mp4",
      targetVideoPath: "/organized/ABC-123.mp4",
      currentDir: "/media",
      targetDir: "/organized",
      changed: true,
    };
    const previewResults = {
      "entry-1": {
        fileId: "entry-1",
        status: "ready" as const,
        fieldDiffs: [fieldDiff],
        unchangedFieldDiffs: [unchangedFieldDiff],
        pathDiff,
      },
    };

    useMaintenanceEntryStore.getState().setEntries([createEntry(createCrawlerData())], "/media");
    useMaintenanceExecutionStore.getState().beginExecution({
      fileIds: ["entry-1"],
    });
    applyMaintenanceExecutionItemResult({
      fileId: "entry-1",
      status: "processing",
    });

    expect(useMaintenanceExecutionStore.getState().itemResults["entry-1"]).toEqual({
      fileId: "entry-1",
      status: "processing",
    });

    const compareGroup = buildMaintenanceEntryGroups([createEntry(createCrawlerData())], {
      itemResults: useMaintenanceExecutionStore.getState().itemResults,
      previewResults,
    })[0];
    expect(compareGroup?.compareResult).toMatchObject({
      fileId: "entry-1",
      fieldDiffs: [fieldDiff],
      unchangedFieldDiffs: [unchangedFieldDiff],
      pathDiff,
    });

    useMaintenanceExecutionStore.getState().rollbackExecutionStart();

    expect(useMaintenanceExecutionStore.getState().executionStatus).toBe("idle");
    expect(useMaintenanceExecutionStore.getState().progressTotal).toBe(0);
    expect(useMaintenanceExecutionStore.getState().itemResults).toEqual({});
  });
});

describe("maintenance preview store", () => {
  it("keeps preview refresh state separate from full invalidation", () => {
    useMaintenanceExecutionStore.setState({
      executionStatus: "idle",
      progressValue: 100,
      progressCurrent: 1,
      progressTotal: 1,
      itemResults: {
        "entry-1": {
          fileId: "entry-1",
          status: "success",
        },
      },
    });
    useMaintenancePreviewStore.setState({
      previewPending: false,
      executeDialogOpen: true,
      previewResults: {
        "entry-1": {
          fileId: "entry-1",
          status: "ready",
        },
      },
      fieldSelections: {
        "entry-1": {
          title: "new",
        },
      },
    });

    useMaintenancePreviewStore.getState().beginPreviewRequest();

    expect(useMaintenancePreviewStore.getState().previewPending).toBe(true);
    expect(useMaintenancePreviewStore.getState().executeDialogOpen).toBe(false);
    expect(useMaintenanceExecutionStore.getState().itemResults).toEqual({
      "entry-1": {
        fileId: "entry-1",
        status: "success",
      },
    });

    clearMaintenancePreviewResults();

    expect(useMaintenancePreviewStore.getState().previewPending).toBe(false);
    expect(useMaintenancePreviewStore.getState().executeDialogOpen).toBe(false);
    expect(useMaintenancePreviewStore.getState().previewResults).toEqual({});
    expect(useMaintenancePreviewStore.getState().fieldSelections).toEqual({});
    expect(useMaintenanceExecutionStore.getState().itemResults).toEqual({
      "entry-1": {
        fileId: "entry-1",
        status: "success",
      },
    });
    useMaintenancePreviewStore.setState({
      previewPending: true,
      executeDialogOpen: true,
      previewResults: {
        "entry-1": {
          fileId: "entry-1",
          status: "ready",
        },
      },
      fieldSelections: {
        "entry-1": {
          title: "new",
        },
      },
    });

    useMaintenanceEntryStore.getState().setEntries([createEntry(createCrawlerData())], "/media");
    invalidateMaintenancePreview();

    expect(useMaintenanceExecutionStore.getState().itemResults).toEqual({});
    expect(useMaintenancePreviewStore.getState().previewPending).toBe(false);
    expect(useMaintenancePreviewStore.getState().executeDialogOpen).toBe(false);
    expect(useMaintenancePreviewStore.getState().previewResults).toEqual({});
    expect(useMaintenancePreviewStore.getState().fieldSelections).toEqual({});
  });

  it("retargets the active entry to the latest preview set and exposes preview diffs instead of stale execution results", () => {
    const firstEntry = createEntry(createCrawlerData());
    const secondEntry: LocalScanEntry = {
      ...createEntry(createCrawlerData({ number: "ABC-124", title: "Another Title", title_zh: "另一个标题" })),
      fileId: "entry-2",
      fileInfo: {
        ...createEntry().fileInfo,
        filePath: "/media/ABC-124.mp4",
        fileName: "ABC-124.mp4",
        number: "ABC-124",
      },
      nfoPath: "/media/ABC-124.nfo",
    };

    useMaintenanceEntryStore.getState().setEntries([firstEntry, secondEntry], "/media");
    useMaintenanceEntryStore.getState().setActiveId("entry-2");
    useMaintenanceExecutionStore.setState({
      executionStatus: "idle",
      progressValue: 100,
      progressCurrent: 1,
      progressTotal: 1,
      itemResults: {
        "entry-1": {
          fileId: "entry-1",
          status: "failed",
          error: "旧执行结果",
        },
      },
    });

    applyMaintenancePreviewResult({
      items: [
        {
          fileId: "entry-1",
          status: "ready",
          fieldDiffs: [
            createValueDiff({
              field: "title",
              label: "标题",
              oldValue: "Old Title",
              newValue: "New Title",
              changed: true,
            }),
          ],
        },
      ],
    });

    const entryState = useMaintenanceEntryStore.getState();
    const executionState = useMaintenanceExecutionStore.getState();
    const previewState = useMaintenancePreviewStore.getState();
    const group = findMaintenanceEntryGroup(entryState.entries, "entry-1", {
      itemResults: executionState.itemResults,
      previewResults: previewState.previewResults,
    });

    expect(entryState.activeId).toBe("entry-1");
    expect(executionState.itemResults).toEqual({});
    expect(group?.compareResult).toMatchObject({
      fileId: "entry-1",
      status: "ready",
    });
  });

  it("invalidates preview state when selection changes under non-diff presets", () => {
    useMaintenanceEntryStore.getState().setEntries(
      [
        createEntry(createCrawlerData()),
        {
          ...createEntry(createCrawlerData({ number: "ABC-124" })),
          fileId: "entry-2",
        },
      ],
      "/media",
    );
    useMaintenanceExecutionStore.setState({
      executionStatus: "idle",
      progressValue: 100,
      progressCurrent: 1,
      progressTotal: 1,
      itemResults: {
        "entry-1": {
          fileId: "entry-1",
          status: "success",
        },
      },
    });
    useMaintenancePreviewStore.setState({
      previewPending: false,
      executeDialogOpen: true,
      previewResults: {
        "entry-1": {
          fileId: "entry-1",
          status: "ready",
        },
      },
      fieldSelections: {
        "entry-1": {
          title: "new",
        },
      },
    });

    toggleMaintenanceSelectedIds(["entry-2"]);

    expect(useMaintenanceEntryStore.getState().selectedIds).toEqual(["entry-1"]);
    expect(useMaintenancePreviewStore.getState().previewResults).toEqual({});
    expect(useMaintenanceExecutionStore.getState().itemResults).toEqual({});
  });

  it("preserves preview state when selection changes under diff presets", () => {
    useMaintenanceEntryStore.getState().setEntries(
      [
        createEntry(createCrawlerData()),
        {
          ...createEntry(createCrawlerData({ number: "ABC-124" })),
          fileId: "entry-2",
        },
      ],
      "/media",
    );
    useMaintenanceEntryStore.getState().setPresetId("refresh_data");
    useMaintenanceExecutionStore.setState({
      executionStatus: "idle",
      progressValue: 100,
      progressCurrent: 1,
      progressTotal: 1,
      itemResults: {
        "entry-1": {
          fileId: "entry-1",
          status: "success",
        },
      },
    });
    useMaintenancePreviewStore.setState({
      previewPending: false,
      executeDialogOpen: true,
      previewResults: {
        "entry-1": {
          fileId: "entry-1",
          status: "ready",
        },
      },
      fieldSelections: {
        "entry-1": {
          title: "new",
        },
      },
    });

    toggleMaintenanceSelectedIds(["entry-2"]);

    expect(useMaintenanceEntryStore.getState().selectedIds).toEqual(["entry-1"]);
    expect(useMaintenancePreviewStore.getState().previewResults).toEqual({
      "entry-1": {
        fileId: "entry-1",
        status: "ready",
      },
    });
    expect(useMaintenanceExecutionStore.getState().itemResults).toEqual({
      "entry-1": {
        fileId: "entry-1",
        status: "success",
      },
    });
  });

  it("invalidates preview state when preset changes", () => {
    useMaintenanceEntryStore.getState().setEntries([createEntry(createCrawlerData())], "/media");
    useMaintenanceEntryStore.getState().setPresetId("refresh_data");
    useMaintenancePreviewStore.setState({
      previewPending: false,
      executeDialogOpen: true,
      previewResults: {
        "entry-1": {
          fileId: "entry-1",
          status: "ready",
        },
      },
      fieldSelections: {
        "entry-1": {
          title: "new",
        },
      },
    });

    changeMaintenancePreset("organize_files");

    expect(useMaintenanceEntryStore.getState().presetId).toBe("organize_files");
    expect(useMaintenancePreviewStore.getState().previewResults).toEqual({});
  });

  it("resets preview flow back to idle state when previewing is canceled", () => {
    useMaintenanceEntryStore.getState().setEntries([createEntry(createCrawlerData())], "/media");
    useMaintenanceExecutionStore.setState({
      executionStatus: "previewing",
      progressValue: 37,
      progressCurrent: 1,
      progressTotal: 3,
      itemResults: {},
    });
    useMaintenancePreviewStore.setState({
      previewPending: true,
      executeDialogOpen: false,
      previewResults: {
        "entry-1": {
          fileId: "entry-1",
          status: "ready",
        },
      },
      fieldSelections: {
        "entry-1": {
          title: "new",
        },
      },
    });

    cancelMaintenancePreviewFlow();

    expect(useMaintenanceExecutionStore.getState()).toMatchObject({
      executionStatus: "idle",
      progressValue: 0,
      progressCurrent: 0,
      progressTotal: 0,
      itemResults: {},
    });
    expect(useMaintenancePreviewStore.getState().previewResults).toEqual({});
    expect(useMaintenancePreviewStore.getState().fieldSelections).toEqual({});
  });
});

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
  countMaintenanceDisplayItems,
  findMaintenanceEntryGroup,
  formatMaintenanceIdleStatusText,
  summarizeMaintenanceExecutionGroups,
  summarizeMaintenancePreviewGroups,
} from "@/lib/maintenanceGrouping";
import { useMaintenanceStore } from "@/store/maintenanceStore";

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
  id: "entry-1",
  videoPath: "/media/ABC-123.mp4",
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
    nfo: "/media/ABC-123.nfo",
    actorPhotos: ["/media/.actors/Actor A.jpg"],
  },
  currentDir: "/media",
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
  useMaintenanceStore.getState().reset();
});

describe("maintenance multipart grouping", () => {
  it("collapses same-directory multipart files into one display group", () => {
    const part1: LocalScanEntry = {
      ...createEntry(createCrawlerData({ number: "FC2-123456" })),
      id: "entry-1",
      videoPath: "/media/FC2-123456-1.mp4",
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
      id: "entry-2",
      videoPath: "/media/FC2-123456-2.mp4",
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
      id: "entry-3",
    };

    const groups = buildMaintenanceEntryGroups([part2, standalone, part1]);

    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.representative.id === "entry-3")).toMatchObject({
      representative: standalone,
    });
    expect(groups.find((group) => group.items.length === 2)?.items.map((entry) => entry.id)).toEqual([
      "entry-1",
      "entry-2",
    ]);
    expect(formatMaintenanceIdleStatusText([part1, part2])).toBe("已扫描 1 项");
  });

  it("uses the same same-directory same-number grouping rule as normal scrape results", () => {
    const first: LocalScanEntry = {
      ...createEntry(createCrawlerData({ number: "ABC-123" })),
      id: "entry-a",
      videoPath: "/media/ABC-123-copy-a.mp4",
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
      id: "entry-b",
      videoPath: "/media/ABC-123-copy-b.mp4",
      fileInfo: {
        ...first.fileInfo,
        filePath: "/media/ABC-123-copy-b.mp4",
        fileName: "ABC-123-copy-b.mp4",
      },
    };

    const groups = buildMaintenanceEntryGroups([first, second]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((entry) => entry.id)).toEqual(["entry-a", "entry-b"]);
  });

  it("derives grouped status and error text from child maintenance results", () => {
    const part1: LocalScanEntry = {
      ...createEntry(),
      id: "entry-1",
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
      id: "entry-2",
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
        entryId: "entry-1",
        status: "success" as const,
      },
      "entry-2": {
        entryId: "entry-2",
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
      entryId: "entry-2",
      status: "failed",
      error: "维护失败",
    });
  });

  it("marks the whole group as failed immediately when any child file fails", () => {
    const part1: LocalScanEntry = {
      ...createEntry(),
      id: "entry-1",
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
      id: "entry-2",
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
          entryId: "entry-1",
          status: "processing",
        },
        "entry-2": {
          entryId: "entry-2",
          status: "failed",
          error: "第二个分盘维护失败",
        },
      },
    });

    expect(group?.status).toBe("failed");
    expect(group?.errorText).toBe("第二个分盘维护失败");
    expect(group?.compareResult).toMatchObject({
      entryId: "entry-2",
      status: "failed",
      error: "第二个分盘维护失败",
    });
  });

  it("summarizes preview counts by grouped movie instead of raw file count", () => {
    const part1: LocalScanEntry = {
      ...createEntry(),
      id: "entry-1",
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
      id: "entry-2",
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
          entryId: "entry-1",
          status: "ready",
        },
        "entry-2": {
          entryId: "entry-2",
          status: "ready",
        },
      }),
    ).toEqual({
      totalCount: 1,
      readyCount: 1,
      blockedCount: 0,
    });
  });

  it("summarizes execution counts by grouped movie instead of raw file count", () => {
    const part1: LocalScanEntry = {
      ...createEntry(),
      id: "entry-1",
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
      id: "entry-2",
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
          entryId: "entry-1",
          status: "success",
        },
        "entry-2": {
          entryId: "entry-2",
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
      id: "entry-1",
      videoPath: `${targetDir}/FC2-123456-1.mp4`,
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
      id: "entry-2",
      videoPath: `${sourceDir}/FC2-123456-2.mp4`,
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
        entryId: "entry-1",
        status: "success" as const,
        pathDiff: {
          entryId: "entry-1",
          currentVideoPath: `${sourceDir}/FC2-123456-1.mp4`,
          targetVideoPath: `${targetDir}/FC2-123456-1.mp4`,
          currentDir: sourceDir,
          targetDir,
          changed: true,
        },
      },
      "entry-2": {
        entryId: "entry-2",
        status: "processing" as const,
        pathDiff: {
          entryId: "entry-2",
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
      id: "entry-a",
      videoPath: "/media/ABC-123-part1.mp4",
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
      id: "entry-b",
      videoPath: "/media/ABC-123-part2.mp4",
      fileInfo: {
        ...first.fileInfo,
        filePath: "/media/ABC-123-part2.mp4",
        fileName: "ABC-123-part2.mp4",
      },
    };

    const group = findMaintenanceEntryGroup([first, second], "entry-b");

    expect(group?.id).toBe("/media::ABC-123");
    expect(group?.representative.id).toBe("entry-a");
    expect(group?.items.map((entry) => entry.id)).toEqual(["entry-a", "entry-b"]);
  });
});

describe("buildCommittedCrawlerData", () => {
  it("merges selected old and new diff values onto the existing crawler data", () => {
    const entry = createEntry(createCrawlerData());
    const preview: MaintenancePreviewItem = {
      entryId: entry.id,
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
      entryId: entry.id,
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
      entryId: sceneEntry.id,
      status: "ready",
      proposedCrawlerData: createCrawlerData({
        scene_images: ["https://example.com/new-scene.jpg"],
      }),
      fieldDiffs: [
        createImageCollectionDiff({
          field: "scene_images",
          label: "场景图",
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
      entryId: remoteEntry.id,
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
      entryId: localEntry.id,
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
      entryId: entry.id,
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

describe("useMaintenanceStore", () => {
  it("preserves preview diffs during optimistic execution, clears stale results on new previews, and can roll back execution state", () => {
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
      entryId: "entry-1",
      currentVideoPath: "/media/ABC-123.mp4",
      targetVideoPath: "/organized/ABC-123.mp4",
      currentDir: "/media",
      targetDir: "/organized",
      changed: true,
    };

    useMaintenanceStore.getState().applyPreviewResult({
      items: [
        {
          entryId: "entry-1",
          status: "ready",
          fieldDiffs: [fieldDiff],
          unchangedFieldDiffs: [unchangedFieldDiff],
          pathDiff,
        },
      ],
    });

    useMaintenanceStore.getState().beginExecution(["entry-1"]);
    useMaintenanceStore.getState().applyItemResult({
      entryId: "entry-1",
      status: "processing",
    });

    expect(useMaintenanceStore.getState().itemResults["entry-1"]).toEqual({
      entryId: "entry-1",
      status: "processing",
      fieldDiffs: [fieldDiff],
      unchangedFieldDiffs: [unchangedFieldDiff],
      pathDiff,
    });

    useMaintenanceStore.getState().applyItemResult({
      entryId: "entry-1",
      status: "success",
      fieldDiffs: [
        createValueDiff({
          field: "title",
          label: "标题",
          oldValue: "Old Title",
          newValue: "Older Preview",
          changed: true,
        }),
      ],
    });

    useMaintenanceStore.getState().applyPreviewResult({
      items: [
        {
          entryId: "entry-1",
          status: "ready",
          unchangedFieldDiffs: [
            createValueDiff({
              field: "title",
              label: "标题",
              oldValue: "Same Title",
              newValue: "Same Title",
              changed: false,
            }),
          ],
        },
      ],
    });

    expect(useMaintenanceStore.getState().itemResults).toEqual({});
    expect(useMaintenanceStore.getState().previewResults["entry-1"]?.unchangedFieldDiffs).toEqual([
      createValueDiff({
        field: "title",
        label: "标题",
        oldValue: "Same Title",
        newValue: "Same Title",
        changed: false,
      }),
    ]);

    useMaintenanceStore.getState().beginExecution(["entry-1"]);
    useMaintenanceStore.getState().rollbackExecutionStart();

    expect(useMaintenanceStore.getState().executionStatus).toBe("idle");
    expect(useMaintenanceStore.getState().progressTotal).toBe(0);
    expect(useMaintenanceStore.getState().itemResults).toEqual({});
    expect(useMaintenanceStore.getState().previewResults["entry-1"]?.unchangedFieldDiffs).toEqual([
      createValueDiff({
        field: "title",
        label: "标题",
        oldValue: "Same Title",
        newValue: "Same Title",
        changed: false,
      }),
    ]);
  });

  it("keeps stopped wording after an interrupted run becomes idle", () => {
    useMaintenanceStore.getState().beginExecution(["entry-1", "entry-2"]);
    useMaintenanceStore.getState().applyItemResult({
      entryId: "entry-1",
      status: "success",
    });
    useMaintenanceStore.getState().applyItemResult({
      entryId: "entry-2",
      status: "failed",
      error: "维护已停止，项目未执行",
    });
    useMaintenanceStore.getState().setExecutionStatus("stopping");
    useMaintenanceStore.getState().setStatusText("正在停止维护操作...");

    useMaintenanceStore.getState().applyStatusSnapshot({
      state: "idle",
      totalEntries: 0,
      completedEntries: 0,
      successCount: 0,
      failedCount: 0,
    });

    expect(useMaintenanceStore.getState().statusText).toBe("已停止 · 成功 1 · 失败/取消 1");
  });
});

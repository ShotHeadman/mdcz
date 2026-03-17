import { Website } from "@shared/enums";
import type { CrawlerData, FieldDiff, LocalScanEntry, MaintenancePreviewItem } from "@shared/types";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCommittedCrawlerData,
  buildMaintenanceCommitItem,
  resolveMaintenanceDiffImageOption,
  resolveMaintenanceDiffImageSrc,
} from "@/lib/maintenance";
import { useMaintenanceStore } from "@/store/maintenanceStore";

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Old Title",
  title_zh: "旧标题",
  number: "ABC-123",
  actors: ["Actor A"],
  genres: ["Drama"],
  sample_images: ["https://example.com/old-scene.jpg"],
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
  it("keeps image alternatives only for fields that still use the preview value", () => {
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
  });

  it("preserves local scene images when selecting the old scene-image set", () => {
    const entry = createEntry(
      createCrawlerData({
        sample_images: [],
      }),
    );
    const preview: MaintenancePreviewItem = {
      entryId: entry.id,
      status: "ready",
      proposedCrawlerData: createCrawlerData({
        sample_images: ["https://example.com/new-scene.jpg"],
      }),
      fieldDiffs: [
        createImageCollectionDiff({
          field: "sample_images",
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

    const item = buildMaintenanceCommitItem(entry, preview, {
      sample_images: "old",
    });

    expect(item.crawlerData?.sample_images).toEqual([]);
    expect(item.assetDecisions).toEqual({
      sceneImages: "preserve",
    });
  });

  it("updates or clears trailer source metadata based on the selected side", () => {
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

  it("replays selected local poster/thumb assets back into the committed crawler data when NFO parsing failed", () => {
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
  it("prefers discovered local artwork for old maintenance images", () => {
    const diff = createImageDiff({
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

    expect(resolveMaintenanceDiffImageSrc(diff, "old")).toBe("/media/poster.jpg");
    expect(resolveMaintenanceDiffImageSrc(diff, "new")).toBe("https://example.com/new-poster.jpg");
  });

  it("falls back to the scanned local asset even when the old NFO image field is empty", () => {
    const diff = createImageDiff({
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

    expect(resolveMaintenanceDiffImageSrc(diff, "old")).toBe("/media/fanart.jpg");
  });

  it("falls back to thumb artwork for fanart previews instead of sample images", () => {
    const diff = createImageDiff({
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

    expect(resolveMaintenanceDiffImageOption(diff, "old")).toEqual({
      src: "/media/thumb.jpg",
      fallbackSrcs: [],
    });
    expect(resolveMaintenanceDiffImageOption(diff, "new")).toEqual({
      src: "https://example.com/new-thumb.jpg",
      fallbackSrcs: ["https://example.com/new-thumb-alt.jpg"],
    });
  });
});

describe("useMaintenanceStore", () => {
  it("keeps preview diffs while an item transitions into processing", () => {
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
      readyCount: 1,
      blockedCount: 0,
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
  });

  it("clears previous execution results when a new preview is applied", () => {
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
      readyCount: 1,
      blockedCount: 0,
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
  });

  it("rolls back optimistic execution state without wiping preview data", () => {
    useMaintenanceStore.getState().applyPreviewResult({
      items: [
        {
          entryId: "entry-1",
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
      readyCount: 1,
      blockedCount: 0,
    });

    useMaintenanceStore.getState().beginExecution(["entry-1"]);
    useMaintenanceStore.getState().rollbackExecutionStart();

    expect(useMaintenanceStore.getState().executionStatus).toBe("idle");
    expect(useMaintenanceStore.getState().progressTotal).toBe(0);
    expect(useMaintenanceStore.getState().itemResults).toEqual({});
    expect(useMaintenanceStore.getState().previewResults["entry-1"]?.fieldDiffs).toEqual([
      createValueDiff({
        field: "title",
        label: "标题",
        oldValue: "Old Title",
        newValue: "New Title",
        changed: true,
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

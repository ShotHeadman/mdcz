import {
  diffCrawlerData,
  diffCrawlerDataWithOptions,
  partitionCrawlerDataWithOptions,
} from "@main/services/scraper/maintenance/diffCrawlerData";
import { Website } from "@shared/enums";
import type { CrawlerData, LocalScanEntry } from "@shared/types";
import { describe, expect, it } from "vitest";

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Sample Title",
  number: "ABC-123",
  actors: ["Actor A"],
  actor_profiles: [{ name: "Actor A", photo_url: ".actors/Actor A.jpg" }],
  genres: [],
  scene_images: [],
  website: Website.DMM,
  ...overrides,
});

const createEntry = (crawlerData: CrawlerData): LocalScanEntry => ({
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
    actorPhotos: [],
  },
  currentDir: "/media",
});

const getEntryCrawlerData = (entry: LocalScanEntry): CrawlerData => {
  if (!entry.crawlerData) {
    throw new Error("Expected crawler data for maintenance diff test");
  }

  return entry.crawlerData;
};

describe("diffCrawlerData", () => {
  it("ignores actor thumbnail path changes because actor_profiles are execution-time derived data", () => {
    const diffs = diffCrawlerData(
      createCrawlerData({
        actor_profiles: [{ name: "Actor A", photo_url: ".actors/Actor A.jpg" }],
      }),
      createCrawlerData({
        actor_profiles: [{ name: "Actor A", photo_url: "https://example.com/actor-a.png" }],
      }),
    );

    expect(diffs).toEqual([]);
  });

  it("still reports actor list changes through the actors field", () => {
    const diffs = diffCrawlerData(
      createCrawlerData({
        actors: ["Actor A"],
        actor_profiles: [{ name: "Actor A", photo_url: ".actors/Actor A.jpg" }],
      }),
      createCrawlerData({
        actors: ["Actor A", "Actor B"],
        actor_profiles: [
          { name: "Actor A", photo_url: ".actors/Actor A.jpg" },
          { name: "Actor B", photo_url: "https://example.com/actor-b.png" },
        ],
      }),
    );

    expect(diffs).toEqual([
      {
        kind: "value",
        field: "actors",
        label: "演员",
        oldValue: ["Actor A"],
        newValue: ["Actor A", "Actor B"],
        changed: true,
      },
    ]);
  });

  it("skips translated fields when translation is disabled for maintenance preview", () => {
    const diffs = diffCrawlerDataWithOptions(
      createCrawlerData({
        title: "Original Title",
        title_zh: "旧中文标题",
        plot: "Original Plot",
        plot_zh: "旧中文简介",
      }),
      createCrawlerData({
        title: "Original Title",
        title_zh: undefined,
        plot: "Original Plot",
        plot_zh: undefined,
      }),
      {
        includeTranslatedFields: false,
      },
    );

    expect(diffs).toEqual([]);
  });

  it("collects unchanged non-empty fields separately for maintenance display", () => {
    const result = partitionCrawlerDataWithOptions(
      createCrawlerData({
        title: "Original Title",
        plot: "Original Plot",
      }),
      createCrawlerData({
        title: "Original Title",
        plot: "Original Plot",
        studio: "New Studio",
      }),
      {},
    );

    expect(result.fieldDiffs).toEqual([
      {
        kind: "value",
        field: "studio",
        label: "制片",
        oldValue: undefined,
        newValue: "New Studio",
        changed: true,
      },
    ]);
    expect(result.unchangedFieldDiffs).toEqual([
      {
        kind: "value",
        field: "title",
        label: "标题",
        oldValue: "Original Title",
        newValue: "Original Title",
        changed: false,
      },
      {
        kind: "value",
        field: "plot",
        label: "简介",
        oldValue: "Original Plot",
        newValue: "Original Plot",
        changed: false,
      },
      {
        kind: "value",
        field: "actors",
        label: "演员",
        oldValue: ["Actor A"],
        newValue: ["Actor A"],
        changed: false,
      },
    ]);
  });

  it("emits a thumb diff and omits background diff when thumb replacement also drives fanart", () => {
    const entry = createEntry(
      createCrawlerData({
        thumb_url: "thumb.jpg",
        fanart_url: undefined,
      }),
    );
    const existingCrawlerData = entry.crawlerData;

    expect(existingCrawlerData).toBeDefined();
    if (!existingCrawlerData) {
      throw new Error("Expected crawler data for maintenance diff test");
    }

    const result = partitionCrawlerDataWithOptions(
      existingCrawlerData,
      createCrawlerData({
        thumb_url: "https://example.com/new-thumb.jpg",
        fanart_url: undefined,
      }),
      {
        entry,
        imageAlternatives: {
          thumb_url: ["https://example.com/new-thumb-alt.jpg"],
        },
      },
    );

    expect(result.fieldDiffs).toContainEqual({
      kind: "image",
      field: "thumb_url",
      label: "封面图",
      oldValue: "thumb.jpg",
      newValue: "https://example.com/new-thumb.jpg",
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
    expect(result.fieldDiffs.find((diff) => diff.field === "fanart_url")).toBeUndefined();
  });

  it("diffs release_date without surfacing a separate release_year field", () => {
    const result = partitionCrawlerDataWithOptions(
      createCrawlerData({
        release_date: "2023-05-06",
      }),
      createCrawlerData({
        release_date: "2024-01-02",
      }),
      {},
    );

    expect(result.fieldDiffs).toEqual([
      {
        kind: "value",
        field: "release_date",
        label: "发行日期",
        oldValue: "2023-05-06",
        newValue: "2024-01-02",
        changed: true,
      },
    ]);
  });

  it("uses persisted source urls to keep matching thumb, trailer, and scene data unchanged", () => {
    const entry = createEntry(
      createCrawlerData({
        thumb_url: "thumb.jpg",
        thumb_source_url: "https://example.com/current-thumb.jpg",
        trailer_url: "trailer.mp4",
        trailer_source_url: "https://example.com/current-trailer.mp4",
        scene_images: ["https://example.com/current-scene.jpg"],
      }),
    );
    const existingCrawlerData = getEntryCrawlerData(entry);

    const result = partitionCrawlerDataWithOptions(
      existingCrawlerData,
      createCrawlerData({
        thumb_url: "https://example.com/current-thumb.jpg",
        trailer_url: "https://example.com/current-trailer.mp4",
        scene_images: ["https://example.com/current-scene.jpg"],
      }),
      {
        entry,
      },
    );

    expect(result.fieldDiffs.find((diff) => ["thumb_url", "trailer_url", "scene_images"].includes(diff.field))).toBe(
      undefined,
    );
    expect(result.unchangedFieldDiffs).toContainEqual({
      kind: "image",
      field: "thumb_url",
      label: "封面图",
      oldValue: "thumb.jpg",
      newValue: "https://example.com/current-thumb.jpg",
      changed: false,
      oldPreview: {
        src: "/media/thumb.jpg",
        fallbackSrcs: [],
      },
      newPreview: {
        src: "https://example.com/current-thumb.jpg",
        fallbackSrcs: [],
      },
    });
    expect(result.unchangedFieldDiffs).toContainEqual({
      kind: "value",
      field: "trailer_url",
      label: "预告片",
      oldValue: "trailer.mp4",
      newValue: "https://example.com/current-trailer.mp4",
      changed: false,
    });
    expect(result.unchangedFieldDiffs).toContainEqual({
      kind: "imageCollection",
      field: "scene_images",
      label: "场景图",
      oldValue: ["https://example.com/current-scene.jpg"],
      newValue: ["https://example.com/current-scene.jpg"],
      changed: false,
      oldPreview: {
        items: ["/media/extrafanart/fanart1.jpg"],
      },
      newPreview: {
        items: ["https://example.com/current-scene.jpg"],
      },
    });
  });

  it("emits a scene-image diff when persisted urls change even if old preview uses local extrafanart", () => {
    const entry = createEntry(
      createCrawlerData({
        scene_images: ["https://example.com/old-scene.jpg"],
      }),
    );
    const existingCrawlerData = getEntryCrawlerData(entry);

    const result = partitionCrawlerDataWithOptions(
      existingCrawlerData,
      createCrawlerData({
        scene_images: ["https://example.com/new-scene.jpg"],
      }),
      {
        entry,
      },
    );

    expect(result.fieldDiffs).toContainEqual({
      kind: "imageCollection",
      field: "scene_images",
      label: "场景图",
      oldValue: ["https://example.com/old-scene.jpg"],
      newValue: ["https://example.com/new-scene.jpg"],
      changed: true,
      oldPreview: {
        items: ["/media/extrafanart/fanart1.jpg"],
      },
      newPreview: {
        items: ["https://example.com/new-scene.jpg"],
      },
    });
  });

  it("uses old sample image urls as the preview baseline when no local scene assets exist", () => {
    const oldData = createCrawlerData({
      scene_images: ["https://example.com/scene-a.jpg"],
    });
    const newData = createCrawlerData({
      scene_images: ["https://example.com/scene-a.jpg"],
    });

    const result = partitionCrawlerDataWithOptions(oldData, newData, {});

    expect(result.fieldDiffs.find((diff) => diff.field === "scene_images")).toBeUndefined();
    expect(result.unchangedFieldDiffs).toContainEqual({
      kind: "imageCollection",
      field: "scene_images",
      label: "场景图",
      oldValue: ["https://example.com/scene-a.jpg"],
      newValue: ["https://example.com/scene-a.jpg"],
      changed: false,
      oldPreview: {
        items: ["https://example.com/scene-a.jpg"],
      },
      newPreview: {
        items: ["https://example.com/scene-a.jpg"],
      },
    });
  });

  it("resolves relative scene image paths against the scanned directory when local assets are missing", () => {
    const entry = {
      ...createEntry(
        createCrawlerData({
          scene_images: ["extrafanart/scene-a.jpg"],
        }),
      ),
      assets: {
        ...createEntry(createCrawlerData()).assets,
        sceneImages: [],
      },
    };

    const result = partitionCrawlerDataWithOptions(
      getEntryCrawlerData(entry),
      createCrawlerData({
        scene_images: ["https://example.com/new-scene.jpg"],
      }),
      { entry },
    );

    expect(result.fieldDiffs.find((diff) => diff.field === "scene_images")).toMatchObject({
      kind: "imageCollection",
      oldPreview: {
        items: ["/media/extrafanart/scene-a.jpg"],
      },
      newPreview: {
        items: ["https://example.com/new-scene.jpg"],
      },
    });
  });
});

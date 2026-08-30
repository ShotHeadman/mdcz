import { Website } from "@mdcz/shared/enums";
import type { CrawlerData, FieldDiff, LocalScanEntry } from "@mdcz/shared/types";

export const createMaintenanceCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Old Title",
  title_zh: "旧标题",
  number: "ABC-123",
  actors: ["Actor A"],
  genres: ["Drama"],
  scene_images: ["https://example.com/old-scene.jpg"],
  website: Website.DMM,
  ...overrides,
});

export const createMaintenanceEntry = (crawlerData?: CrawlerData): LocalScanEntry => ({
  fileId: "entry-1",
  ref: { rootId: "test-root", relativePath: "test.mp4" },
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

export const createMaintenanceValueDiff = (overrides: ValueDiffInput): FieldDiff => ({
  kind: "value",
  ...overrides,
});

export const createMaintenanceImageDiff = (overrides: ImageDiffInput): FieldDiff => ({
  kind: "image",
  ...overrides,
});

export const createMaintenanceImageCollectionDiff = (overrides: ImageCollectionDiffInput): FieldDiff => ({
  kind: "imageCollection",
  ...overrides,
});

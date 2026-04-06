import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { SignalService } from "@main/services/SignalService";
import { MaintenanceFileScraper } from "@main/services/scraper/maintenance/MaintenanceFileScraper";
import { getPreset } from "@main/services/scraper/maintenance/presets";
import { Website } from "@shared/enums";
import type { CrawlerData, LocalScanEntry } from "@shared/types";
import { describe, expect, it, vi } from "vitest";

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Remote Title",
  number: "ABC-123",
  actors: ["Actor A"],
  genres: ["Drama"],
  scene_images: [],
  website: Website.DMM,
  ...overrides,
});

const createEntry = (): LocalScanEntry => ({
  fileId: "entry-1",
  fileInfo: {
    filePath: "/media/ABC-123.mp4",
    fileName: "ABC-123.mp4",
    extension: ".mp4",
    number: "ABC-123",
    isSubtitled: false,
  },
  nfoPath: "/media/ABC-123.nfo",
  crawlerData: undefined,
  scanError: "NFO 解析失败: NFO missing website",
  assets: {
    thumb: "/media/thumb.jpg",
    poster: "/media/poster.jpg",
    fanart: "/media/fanart.jpg",
    sceneImages: [],
    trailer: undefined,
    actorPhotos: [],
  },
  currentDir: "/media",
});

const plan = {
  outputDir: "/organized/ABC-123",
  targetVideoPath: "/organized/ABC-123/ABC-123.mp4",
  nfoPath: "/organized/ABC-123/ABC-123.nfo",
};

const createScraper = (crawlerData: CrawlerData) =>
  new MaintenanceFileScraper(
    {
      configManager: {} as never,
      aggregationService: {
        aggregate: vi.fn().mockResolvedValue({
          data: crawlerData,
          sources: {},
          imageAlternatives: {},
        }),
      } as never,
      translateService: {
        translateCrawlerData: vi.fn(async (data: CrawlerData) => data),
      } as never,
      nfoGenerator: {
        writeNfo: vi.fn(),
      } as never,
      downloadManager: {
        downloadAll: vi.fn(),
      } as never,
      fileOrganizer: {
        plan: vi.fn().mockReturnValue(plan),
        resolveOutputPlan: vi.fn(async () => plan),
      } as never,
      signalService: new SignalService(null),
    },
    getPreset("refresh_data"),
  );

describe("MaintenanceFileScraper preview diffs", () => {
  it("builds refresh-data diffs against a fallback baseline when local NFO parsing failed", async () => {
    const crawlerData = createCrawlerData({
      title_zh: "远程标题",
      plot: "Remote Plot",
      thumb_url: "https://example.com/thumb.jpg",
      trailer_url: "https://example.com/trailer.mp4",
    });
    const scraper = createScraper(crawlerData);
    const result = await scraper.previewFile(
      {
        ...createEntry(),
        assets: {
          ...createEntry().assets,
          trailer: "/media/trailer.mp4",
        },
      },
      configurationSchema.parse(defaultConfiguration),
    );

    expect(result.status).toBe("ready");
    expect(result.fieldDiffs?.find((diff) => diff.field === "title")).toMatchObject({
      kind: "value",
      changed: true,
      oldValue: "",
      newValue: "Remote Title",
    });
    expect(result.fieldDiffs?.find((diff) => diff.field === "thumb_url")).toMatchObject({
      kind: "image",
      changed: true,
    });
    expect(result.fieldDiffs?.find((diff) => diff.field === "trailer_url")).toMatchObject({
      kind: "value",
      oldValue: "trailer.mp4",
      newValue: "https://example.com/trailer.mp4",
      changed: true,
    });
  });
});

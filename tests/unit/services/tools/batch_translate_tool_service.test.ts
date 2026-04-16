import { resolve } from "node:path";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import type { NetworkClient } from "@main/services/network";
import type { LlmApiClient } from "@main/services/scraper/translate/engines/LlmApiClient";
import { BatchTranslateToolService } from "@main/services/tools/BatchTranslateToolService";
import { Website } from "@shared/enums";
import type { BatchTranslateScanItem } from "@shared/ipcTypes";
import type { LocalScanEntry } from "@shared/types";
import { describe, expect, it, vi } from "vitest";

const createConfig = (overrides: Partial<ReturnType<typeof configurationSchema.parse>> = {}) =>
  configurationSchema.parse({
    ...defaultConfiguration,
    ...overrides,
    translate: {
      ...defaultConfiguration.translate,
      llmModelName: "gpt-5.2",
      llmApiKey: "test-key",
      targetLanguage: "zh-CN",
      ...(overrides.translate ?? {}),
    },
  });

const createEntry = (overrides: Partial<LocalScanEntry> = {}): LocalScanEntry => ({
  fileId: "file-id",
  fileInfo: {
    filePath: overrides.fileInfo?.filePath ?? "/library/ABC-123.mp4",
    fileName: overrides.fileInfo?.fileName ?? "ABC-123.mp4",
    extension: overrides.fileInfo?.extension ?? ".mp4",
    number: overrides.fileInfo?.number ?? "ABC-123",
    isSubtitled: overrides.fileInfo?.isSubtitled ?? false,
    subtitleTag: overrides.fileInfo?.subtitleTag,
    isUncensored: overrides.fileInfo?.isUncensored,
    resolution: overrides.fileInfo?.resolution,
    part: overrides.fileInfo?.part,
  },
  nfoPath: overrides.nfoPath ?? "/library/ABC-123.nfo",
  crawlerData: overrides.crawlerData ?? {
    title: "Original Title",
    title_zh: "Original Title",
    number: "ABC-123",
    actors: [],
    genres: [],
    plot: "Original Plot",
    plot_zh: "Original Plot",
    scene_images: [],
    website: Website.JAVDB,
  },
  nfoLocalState: overrides.nfoLocalState,
  scanError: overrides.scanError,
  assets: overrides.assets ?? {
    sceneImages: [],
    actorPhotos: [],
  },
  currentDir: overrides.currentDir ?? "/library",
  groupingDirectory: overrides.groupingDirectory ?? "/library",
});

const createService = (
  options: {
    scan?: (dirPath: string, sceneImagesFolder: string) => Promise<LocalScanEntry[]>;
    scanVideo?: (videoPath: string, sceneImagesFolder: string) => Promise<LocalScanEntry>;
    generateText?: LlmApiClient["generateText"];
    writeNfo?: (...args: Parameters<BatchTranslateToolService["apply"]>) => never;
  } = {},
) => {
  const localScanService = {
    scan: vi.fn(options.scan ?? (async () => [])),
    scanVideo: vi.fn(options.scanVideo ?? (async () => createEntry())),
  };
  const llmApiClient = {
    generateText: options.generateText ?? vi.fn(),
  } as unknown as LlmApiClient;
  const writeNfo =
    options.writeNfo ??
    vi.fn(async ({ nfoPath }: { nfoPath?: string }) => {
      return nfoPath;
    });

  const service = new BatchTranslateToolService({} as NetworkClient, {
    localScanService,
    llmApiClient,
    writeNfo: writeNfo as never,
  });

  return {
    service,
    localScanService,
    llmApiClient,
    writeNfo,
  };
};

describe("BatchTranslateToolService", () => {
  it("scans only entries whose title or plot still need translation", async () => {
    const config = createConfig();

    const { service, localScanService } = createService({
      scan: async () => [
        createEntry({
          fileInfo: {
            filePath: "/library/AAA-001.mp4",
            fileName: "AAA-001.mp4",
            extension: ".mp4",
            number: "AAA-001",
            isSubtitled: false,
          },
          nfoPath: "/library/AAA-001.nfo",
          crawlerData: {
            title: "Same English Title",
            title_zh: "Same English Title",
            number: "AAA-001",
            actors: [],
            genres: [],
            plot: "English plot",
            plot_zh: "English plot",
            scene_images: [],
            website: Website.JAVDB,
          },
        }),
        createEntry({
          fileInfo: {
            filePath: "/library/BBB-002.mp4",
            fileName: "BBB-002.mp4",
            extension: ".mp4",
            number: "BBB-002",
            isSubtitled: false,
          },
          nfoPath: "/library/BBB-002.nfo",
          crawlerData: {
            title: "原始标题",
            title_zh: "中文标题",
            number: "BBB-002",
            actors: [],
            genres: [],
            plot: "中文简介",
            plot_zh: "中文简介",
            scene_images: [],
            website: Website.JAVDB,
          },
        }),
        createEntry({
          fileInfo: {
            filePath: "/library/CCC-003.mp4",
            fileName: "CCC-003.mp4",
            extension: ".mp4",
            number: "CCC-003",
            isSubtitled: false,
          },
          nfoPath: "/library/CCC-003.nfo",
          crawlerData: {
            title: "Original Title",
            title_zh: "繁體標題",
            number: "CCC-003",
            actors: [],
            genres: [],
            plot: "",
            plot_zh: "",
            scene_images: [],
            website: Website.JAVDB,
          },
        }),
      ],
    });

    const scanRoot = resolve("/library");
    const items = await service.scan(scanRoot, config);

    expect(localScanService.scan).toHaveBeenCalledWith(scanRoot, config.paths.sceneImagesFolder);
    expect(items).toEqual<BatchTranslateScanItem[]>([
      expect.objectContaining({
        number: "AAA-001",
        pendingFields: ["title", "plot"],
      }),
      expect.objectContaining({
        number: "CCC-003",
        pendingFields: ["title"],
      }),
    ]);
  });

  it("batches unique texts and writes translated fields back to NFOs", async () => {
    const config = createConfig();
    const generateText = vi.fn().mockResolvedValue('["相同标题","剧情一"]');
    const writeNfo = vi.fn(async ({ nfoPath }: { nfoPath?: string }) => nfoPath);

    const entriesByPath = new Map<string, LocalScanEntry>([
      [
        "/library/AAA-001.mp4",
        createEntry({
          fileInfo: {
            filePath: "/library/AAA-001.mp4",
            fileName: "AAA-001.mp4",
            extension: ".mp4",
            number: "AAA-001",
            isSubtitled: false,
          },
          nfoPath: "/library/AAA-001.nfo",
          crawlerData: {
            title: "Same English Title",
            title_zh: "Same English Title",
            number: "AAA-001",
            actors: [],
            genres: [],
            plot: "Plot 1",
            plot_zh: "Plot 1",
            scene_images: [],
            website: Website.JAVDB,
          },
        }),
      ],
      [
        "/library/BBB-002.mp4",
        createEntry({
          fileInfo: {
            filePath: "/library/BBB-002.mp4",
            fileName: "BBB-002.mp4",
            extension: ".mp4",
            number: "BBB-002",
            isSubtitled: false,
          },
          nfoPath: "/library/BBB-002.nfo",
          crawlerData: {
            title: "Same English Title",
            title_zh: "Same English Title",
            number: "BBB-002",
            actors: [],
            genres: [],
            plot: "",
            plot_zh: "",
            scene_images: [],
            website: Website.JAVDB,
          },
        }),
      ],
      [
        "/library/CCC-003.mp4",
        createEntry({
          fileInfo: {
            filePath: "/library/CCC-003.mp4",
            fileName: "CCC-003.mp4",
            extension: ".mp4",
            number: "CCC-003",
            isSubtitled: false,
          },
          nfoPath: "/library/CCC-003.nfo",
          crawlerData: {
            title: "Original Title",
            title_zh: "繁體標題",
            number: "CCC-003",
            actors: [],
            genres: [],
            plot: "",
            plot_zh: "",
            scene_images: [],
            website: Website.JAVDB,
          },
        }),
      ],
    ]);

    const { service, localScanService } = createService({
      scanVideo: async (videoPath) => {
        const matched = entriesByPath.get(videoPath);
        if (!matched) {
          throw new Error(`Unexpected scan path: ${videoPath}`);
        }
        return matched;
      },
      generateText,
      writeNfo: writeNfo as never,
    });

    const results = await service.apply(
      [
        {
          filePath: "/library/AAA-001.mp4",
          nfoPath: "/library/AAA-001.nfo",
          directory: "/library",
          number: "AAA-001",
          title: "Same English Title",
          pendingFields: ["title", "plot"],
        },
        {
          filePath: "/library/BBB-002.mp4",
          nfoPath: "/library/BBB-002.nfo",
          directory: "/library",
          number: "BBB-002",
          title: "Same English Title",
          pendingFields: ["title"],
        },
        {
          filePath: "/library/CCC-003.mp4",
          nfoPath: "/library/CCC-003.nfo",
          directory: "/library",
          number: "CCC-003",
          title: "繁體標題",
          pendingFields: ["title"],
        },
      ],
      config,
    );

    expect(localScanService.scanVideo).toHaveBeenCalledTimes(3);
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('"Same English Title"'),
      }),
      undefined,
    );
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('"Plot 1"'),
      }),
      undefined,
    );
    expect(writeNfo).toHaveBeenCalledTimes(3);

    const firstWrite = writeNfo.mock.calls[0]?.[0] as { crawlerData: { title_zh?: string; plot_zh?: string } };
    expect(firstWrite.crawlerData.title_zh).toBe("相同标题");
    expect(firstWrite.crawlerData.plot_zh).toBe("剧情一");

    const secondWrite = writeNfo.mock.calls[1]?.[0] as { crawlerData: { title_zh?: string } };
    expect(secondWrite.crawlerData.title_zh).toBe("相同标题");

    const thirdWrite = writeNfo.mock.calls[2]?.[0] as { crawlerData: { title_zh?: string } };
    expect(thirdWrite.crawlerData.title_zh).toBe("繁体标题");

    expect(results).toEqual([
      expect.objectContaining({
        number: "AAA-001",
        success: true,
        translatedFields: ["title", "plot"],
      }),
      expect.objectContaining({
        number: "BBB-002",
        success: true,
        translatedFields: ["title"],
      }),
      expect.objectContaining({
        number: "CCC-003",
        success: true,
        translatedFields: ["title"],
      }),
    ]);
  });
});

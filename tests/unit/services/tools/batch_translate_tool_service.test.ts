import { resolve } from "node:path";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { BatchTranslateToolService } from "@main/services/tools/BatchTranslateToolService";
import type { NetworkClient } from "@mdcz/runtime/network";
import type { LlmApiClient } from "@mdcz/runtime/scrape";
import { Website } from "@mdcz/shared/enums";
import type { BatchTranslateScanItem } from "@mdcz/shared/ipcTypes";
import type { LocalScanEntry } from "@mdcz/shared/types";
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

type EntryOverrides = Omit<Partial<LocalScanEntry>, "assets" | "crawlerData" | "fileInfo"> & {
  assets?: Partial<LocalScanEntry["assets"]>;
  crawlerData?: Partial<NonNullable<LocalScanEntry["crawlerData"]>>;
  fileInfo?: Partial<LocalScanEntry["fileInfo"]>;
};

const createEntry = (overrides: EntryOverrides = {}): LocalScanEntry => ({
  fileId: "file-id",
  fileInfo: {
    filePath: "/library/ABC-123.mp4",
    fileName: "ABC-123.mp4",
    extension: ".mp4",
    number: "ABC-123",
    isSubtitled: false,
    ...overrides.fileInfo,
  },
  nfoPath: overrides.nfoPath ?? "/library/ABC-123.nfo",
  crawlerData: {
    title: "Original Title",
    title_zh: "Original Title",
    number: "ABC-123",
    actors: [],
    genres: [],
    plot: "Original Plot",
    plot_zh: "Original Plot",
    scene_images: [],
    website: Website.JAVDB,
    ...overrides.crawlerData,
  },
  nfoLocalState: overrides.nfoLocalState,
  scanError: overrides.scanError,
  assets: {
    sceneImages: [],
    actorPhotos: [],
    ...overrides.assets,
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
            number: "AAA-001",
          },
          nfoPath: "/library/AAA-001.nfo",
          crawlerData: {
            title: "Same English Title",
            title_zh: "Same English Title",
            number: "AAA-001",
            plot: "English plot",
            plot_zh: "English plot",
          },
        }),
        createEntry({
          fileInfo: {
            filePath: "/library/BBB-002.mp4",
            fileName: "BBB-002.mp4",
            number: "BBB-002",
          },
          nfoPath: "/library/BBB-002.nfo",
          crawlerData: {
            title: "原始标题",
            title_zh: "中文标题",
            number: "BBB-002",
            plot: "中文简介",
            plot_zh: "中文简介",
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
    ]);
  });

  it("batches unique texts and writes translated fields back to NFOs", async () => {
    const config = createConfig({
      download: {
        ...defaultConfiguration.download,
        nfoIgnoreFields: ["director"],
      },
    });
    const generateText = vi.fn().mockResolvedValue('["相同标题","剧情一"]');
    const writeNfo = vi.fn(async ({ nfoPath }: { nfoPath?: string }) => nfoPath);

    const entriesByPath = new Map<string, LocalScanEntry>([
      [
        "/library/AAA-001.mp4",
        createEntry({
          fileInfo: {
            filePath: "/library/AAA-001.mp4",
            fileName: "AAA-001.mp4",
            number: "AAA-001",
          },
          nfoPath: "/library/AAA-001.nfo",
          crawlerData: {
            title: "Same English Title",
            title_zh: "Same English Title",
            number: "AAA-001",
            plot: "Plot 1",
            plot_zh: "Plot 1",
          },
        }),
      ],
      [
        "/library/BBB-002.mp4",
        createEntry({
          fileInfo: {
            filePath: "/library/BBB-002.mp4",
            fileName: "BBB-002.mp4",
            number: "BBB-002",
          },
          nfoPath: "/library/BBB-002.nfo",
          crawlerData: {
            title: "Same English Title",
            title_zh: "Same English Title",
            number: "BBB-002",
            plot: "",
            plot_zh: "",
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

    await service.apply(
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
      ],
      config,
    );

    expect(localScanService.scanVideo).toHaveBeenCalledTimes(2);
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('"Same English Title"'),
      }),
      undefined,
    );
    expect(writeNfo).toHaveBeenCalledTimes(2);

    const firstWrite = writeNfo.mock.calls[0]?.[0] as {
      config: { download: { nfoIgnoreFields: string[] } };
      crawlerData: { title_zh?: string; plot_zh?: string };
    };
    expect(firstWrite.crawlerData.title_zh).toBe("相同标题");
    expect(firstWrite.crawlerData.plot_zh).toBe("剧情一");
    expect(firstWrite.config.download.nfoIgnoreFields).toEqual(["director"]);

    const secondWrite = writeNfo.mock.calls[1]?.[0] as { crawlerData: { title_zh?: string } };
    expect(secondWrite.crawlerData.title_zh).toBe("相同标题");
  });
});

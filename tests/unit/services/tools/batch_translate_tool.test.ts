import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { MediaRoot } from "@mdcz/media-store";
import type { LlmApiClient } from "@mdcz/runtime/llm";
import { parseNfoSnapshot } from "@mdcz/runtime/maintenance";
import { NfoGenerator } from "@mdcz/runtime/scrape";
import {
  applyBatchNfoTranslations,
  type BatchNfoTranslatorApplyOptions,
  type BatchNfoTranslatorDependencies,
  scanBatchNfoTranslations,
} from "@mdcz/runtime/tools";
import { type Configuration, configurationSchema, defaultConfiguration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import type { BatchTranslateMode, BatchTranslateScanItem } from "@mdcz/shared/toolTypes";
import type { LocalScanEntry } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const createConfig = (overrides: Partial<ReturnType<typeof configurationSchema.parse>> = {}) =>
  configurationSchema.parse({
    ...defaultConfiguration,
    ...overrides,
    translate: {
      ...defaultConfiguration.translate,
      targetLanguage: "zh-CN",
      ...(overrides.translate ?? {}),
    },
    llm: { ...defaultConfiguration.llm, apiKey: "test-key", ...(overrides.llm ?? {}) },
  });

type EntryOverrides = Omit<Partial<LocalScanEntry>, "assets" | "crawlerData" | "fileInfo"> & {
  assets?: Partial<LocalScanEntry["assets"]>;
  crawlerData?: Partial<NonNullable<LocalScanEntry["crawlerData"]>>;
  fileInfo?: Partial<LocalScanEntry["fileInfo"]>;
};

const createEntry = (overrides: EntryOverrides = {}): LocalScanEntry => {
  const nfoPath = overrides.nfoPath ?? "/library/ABC-123.nfo";
  return {
    fileId: "file-id",
    ref: { rootId: "test-root", relativePath: "test.mp4" },
    fileInfo: {
      filePath: "/library/ABC-123.mp4",
      fileName: "ABC-123.mp4",
      extension: ".mp4",
      number: "ABC-123",
      isSubtitled: false,
      ...overrides.fileInfo,
    },
    nfoPath,
    nfoPaths: overrides.nfoPaths ?? [nfoPath],
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
  };
};

const createService = (
  options: {
    scan?: (dirPath: string, sceneImagesFolder: string) => Promise<LocalScanEntry[]>;
    scanVideo?: (root: MediaRoot, videoPath: string, sceneImagesFolder: string) => Promise<LocalScanEntry>;
    generateText?: LlmApiClient["generateText"];
    rootPath?: string;
    publication?: Omit<NonNullable<BatchNfoTranslatorDependencies["publication"]>, "roots">;
  } = {},
) => {
  const localScanService = {
    scan: vi.fn(options.scan ?? (async () => [])),
    scanVideo: vi.fn(options.scanVideo ?? (async () => createEntry())),
  };
  const llmApiClient = {
    generateText: options.generateText ?? vi.fn(),
  } as unknown as LlmApiClient;
  const roots = [{ id: "library", hostPath: options.rootPath ?? "/library" }];
  const service = {
    scan: (directory: string, mode: BatchTranslateMode, config: Configuration) =>
      scanBatchNfoTranslations(directory, mode, config, { localScanService }),
    apply: (items: BatchTranslateScanItem[], config: Configuration, applyOptions: BatchNfoTranslatorApplyOptions) =>
      applyBatchNfoTranslations(
        items,
        config,
        {
          localScanService,
          llmApiClient,
          nfoGenerator: new NfoGenerator(),
          publication: { roots, ...options.publication },
        },
        applyOptions,
      ),
  };

  return {
    service,
    localScanService,
    llmApiClient,
  };
};

describe("batch NFO translation tool", () => {
  it("scans the titles and plots the chosen mode covers", async () => {
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
            title: "元のタイトル",
            title_zh: "中文标题",
            number: "BBB-002",
            plot: "中文简介",
            plot_zh: "中文简介",
          },
        }),
      ],
    });

    const scanRoot = resolve("/library");
    const untranslated = await service.scan(scanRoot, "untranslated", config);
    const all = await service.scan(scanRoot, "all", config);
    const restore = await service.scan(scanRoot, "restore", config);

    expect(localScanService.scan).toHaveBeenCalledWith(scanRoot, config.paths.sceneImagesFolder);
    expect(untranslated).toEqual<BatchTranslateScanItem[]>([
      expect.objectContaining({ number: "AAA-001", pendingFields: ["title", "plot"] }),
    ]);
    // A Chinese source needs no translation in either mode; a translated Japanese title is retranslated.
    expect(all).toEqual<BatchTranslateScanItem[]>([
      expect.objectContaining({ number: "AAA-001", pendingFields: ["title", "plot"] }),
      expect.objectContaining({ number: "BBB-002", pendingFields: ["title"] }),
    ]);
    expect(restore).toEqual<BatchTranslateScanItem[]>([
      expect.objectContaining({ number: "BBB-002", pendingFields: ["title"] }),
    ]);
  });

  it("restores only the translated text in every NFO copy of a library movie", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-batch-restore-"));
    tempDirs.push(root);
    const nfoNames = ["movie.nfo", "CCC-003.nfo"];
    const nfoPaths = nfoNames.map((name) => join(root, name));
    const entry = createEntry({
      fileInfo: { filePath: join(root, "CCC-003.mp4"), fileName: "CCC-003.mp4", number: "CCC-003" },
      nfoPath: nfoPaths[0],
      nfoPaths,
      currentDir: root,
      crawlerData: {
        title: "元のタイトル",
        title_zh: "中文标题",
        number: "CCC-003",
        plot: "元の説明",
        plot_zh: "中文简介",
      },
    });
    const untouched = [
      "<dateadded>2025-01-01 00:00:00</dateadded>",
      "<tag>自定义标签</tag>",
      "<lockdata>true</lockdata>",
      "<image>https://example.com/scene-1.jpg</image>",
    ];
    // The copy the scan did not read holds content of its own, which a translation must not drop.
    await writeFile(nfoPaths[0], "<movie><title>中文标题</title><num>CCC-003</num></movie>");
    await writeFile(
      nfoPaths[1],
      `<movie><title>中文标题</title><num>CCC-003</num>${untouched.slice(0, 3).join("")}<mdcz><scene_images>${untouched[3]}</scene_images></mdcz></movie>`,
    );
    const writeEntry = vi.fn(() => "movie-a");
    const library = {
      publicationRoots: () => [{ id: "library", hostPath: root }],
      publicationSnapshot: () => ({
        files: [{ itemId: "movie-a", fileId: "file-a", rootId: "library", relativePath: "CCC-003.mp4" }],
        assets: nfoNames.map((relativePath) => ({
          itemId: "movie-a",
          fileId: null,
          rootId: "library",
          relativePath,
          kind: "nfo",
          published: true,
        })),
      }),
      getEntryById: async () => ({ assets: [] }),
      writeEntry,
    };
    const generateText = vi.fn();
    const { service } = createService({
      scanVideo: async () => entry,
      generateText,
      rootPath: root,
      publication: { outputs: library, library },
    });

    const [result] = await service.apply(
      [
        {
          filePath: entry.fileInfo.filePath,
          nfoPath: nfoPaths[0],
          directory: root,
          number: "CCC-003",
          title: "中文标题",
          pendingFields: ["title", "plot"],
        },
      ],
      createConfig(),
      { mode: "restore" },
    );

    expect(generateText).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, translatedFields: ["title", "plot"] });
    const [readCopy, otherCopy] = await Promise.all(nfoPaths.map((nfoPath) => readFile(nfoPath, "utf8")));
    for (const xml of [readCopy, otherCopy]) {
      expect(xml).toContain("<title>元のタイトル</title>");
      expect(xml).toContain("<plot>元の説明</plot>");
      expect(xml).not.toContain("中文");
      // MDCz wrote the restored text, so it must not read back as someone's edit.
      expect(parseNfoSnapshot(xml).localState?.edits).toBeUndefined();
    }
    for (const element of untouched) expect(otherCopy).toContain(element);
    expect(writeEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        assets: expect.arrayContaining(
          nfoNames.map((relativePath) => expect.objectContaining({ kind: "nfo", relativePath })),
        ),
      }),
      [],
    );
  });

  it("translates each unique text once and writes the NFOs the scan found", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-batch-translation-"));
    tempDirs.push(root);
    const config = createConfig({
      download: {
        ...defaultConfiguration.download,
        nfoIgnoreFields: ["director"],
      },
    });
    const generateText = vi.fn().mockResolvedValue('{"translations":["相同标题","剧情一"]}');
    const entries = [
      createEntry({
        fileInfo: { filePath: join(root, "AAA-001.mp4"), fileName: "AAA-001.mp4", number: "AAA-001" },
        nfoPath: join(root, "AAA-001.nfo"),
        currentDir: root,
        crawlerData: {
          title: "Same English Title",
          title_zh: "Same English Title",
          number: "AAA-001",
          director: "Director",
          plot: "Plot 1",
          plot_zh: "Plot 1",
        },
      }),
      createEntry({
        fileInfo: { filePath: join(root, "BBB-002.mp4"), fileName: "BBB-002.mp4", number: "BBB-002" },
        nfoPath: join(root, "BBB-002.nfo"),
        currentDir: root,
        crawlerData: {
          title: "Same English Title",
          title_zh: "Same English Title",
          number: "BBB-002",
          plot: "",
          plot_zh: "",
        },
      }),
    ];
    const nfoPaths = entries.map((entry) => entry.nfoPaths[0]);
    for (const nfoPath of nfoPaths) await writeFile(nfoPath, "<movie><title>Original</title></movie>");

    const { service, localScanService } = createService({
      scanVideo: async (_root, videoPath) => {
        const matched = entries.find((entry) => entry.fileInfo.filePath === videoPath);
        if (!matched) throw new Error(`Unexpected scan path: ${videoPath}`);
        return matched;
      },
      generateText,
      rootPath: root,
    });

    const results = await service.apply(
      entries.map(
        (entry, index): BatchTranslateScanItem => ({
          filePath: entry.fileInfo.filePath,
          nfoPath: nfoPaths[index],
          directory: root,
          number: entry.fileInfo.number,
          title: "Same English Title",
          pendingFields: index === 0 ? ["title", "plot"] : ["title"],
        }),
      ),
      config,
      { mode: "untranslated" },
    );

    expect(localScanService.scanVideo).toHaveBeenCalledTimes(2);
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.stringContaining('["Same English Title","Plot 1"]') }),
    );
    expect(results.every(({ success }) => success)).toBe(true);
    const [first, second] = await Promise.all(nfoPaths.map((nfoPath) => readFile(nfoPath, "utf8")));
    expect(first).toContain("<title>相同标题</title>");
    expect(first).toContain("<plot>剧情一</plot>");
    expect(first).not.toContain("<director>");
    expect(second).toContain("<title>相同标题</title>");
  });
});

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServiceContainer } from "@main/container";
import { createFileHandlers } from "@main/ipc/handlers/file";
import { configManager } from "@main/services/config/ConfigManager";
import { defaultConfiguration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@egoist/tipc/main", () => {
  type MockProcedure = {
    input: () => MockProcedure;
    action: <TInput, TResult>(
      action: (args: { context: unknown; input: TInput }) => Promise<TResult>,
    ) => {
      action: (args: { context: unknown; input: TInput }) => Promise<TResult>;
    };
  };
  const createProcedure = (): MockProcedure => ({
    input: () => createProcedure(),
    action: (action) => ({ action }),
  });

  return {
    tipc: {
      create: () => ({ procedure: createProcedure() }),
    },
  };
});

vi.mock("electron", () => {
  const app = {
    isReady: () => false,
    isPackaged: true,
    getPath: () => join(tmpdir(), "mdcz-vitest-file-handlers"),
    commandLine: {
      appendSwitch: vi.fn(),
    },
    setAppUserModelId: vi.fn(),
  };

  return {
    app,
    ipcMain: {
      handle: vi.fn(),
      once: vi.fn(),
      removeHandler: vi.fn(),
    },
    dialog: {
      showOpenDialog: vi.fn(),
    },
  };
});

const actionArgs = <TInput>(input: TInput) => ({ context: { sender: {} as never }, input });

const createContext = (): ServiceContainer =>
  ({
    windowService: {
      getMainWindow: () => null,
    },
  }) as unknown as ServiceContainer;

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-file-handler-"));
  tempDirs.push(dirPath);
  return dirPath;
};

describe("createFileHandlers", () => {
  beforeEach(() => {
    vi.spyOn(configManager, "getValidated").mockResolvedValue(defaultConfiguration);
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
    );
    vi.restoreAllMocks();
  });

  it("lists recursive media candidates with metadata and skips generated sidecars", async () => {
    const root = await createTempDir();
    const nested = join(root, "nested");
    const rootVideo = join(root, "ABC-123.mp4");
    const nestedVideo = join(nested, "DEF-456.mkv");

    await mkdir(nested, { recursive: true });
    await writeFile(rootVideo, "video-a");
    await writeFile(nestedVideo, "video-b");
    await writeFile(join(root, "trailer.mp4"), "trailer");
    await writeFile(join(root, "ignore.txt"), "ignore");

    const handlers = createFileHandlers(createContext());
    const result = await handlers[IpcChannel.File_ListMediaCandidates].action(actionArgs({ dirPath: root }));

    expect(result.supportedExtensions).toEqual(expect.arrayContaining(["mp4", "mkv", "strm"]));
    expect(result.candidates).toEqual([
      expect.objectContaining({
        path: rootVideo,
        name: "ABC-123.mp4",
        extension: ".mp4",
        relativePath: "ABC-123.mp4",
        relativeDirectory: "",
        size: 7,
      }),
      expect.objectContaining({
        path: nestedVideo,
        name: "DEF-456.mkv",
        extension: ".mkv",
        relativePath: join("nested", "DEF-456.mkv"),
        relativeDirectory: "nested",
        size: 7,
      }),
    ]);
  });
  it("excludes blacklisted basenames using case-insensitive literal token matching", async () => {
    const root = await createTempDir();
    const keptVideo = join(root, "ABC-123.mp4");
    const nearMatchVideo = join(root, "Ads-2024-GHI-789.mp4");
    const blacklistedVideo = join(root, "DEF-456-AdS+[2024].mkv");

    await writeFile(keptVideo, "keep");
    await writeFile(nearMatchVideo, "near");
    await writeFile(blacklistedVideo, "blocked");
    vi.mocked(configManager.getValidated).mockResolvedValue({
      ...defaultConfiguration,
      scrape: {
        ...defaultConfiguration.scrape,
        filenameBlacklistTokens: ["ads+[2024]", "   "],
      },
    });

    const handlers = createFileHandlers(createContext());
    const result = await handlers[IpcChannel.File_ListMediaCandidates].action(actionArgs({ dirPath: root }));

    expect(result.candidates.map((candidate) => candidate.name)).toEqual(["ABC-123.mp4", "Ads-2024-GHI-789.mp4"]);
  });

  it("skips media files inside an excluded output directory nested under the scan root", async () => {
    const root = await createTempDir();
    const libraryDir = join(root, "library");
    const outputDir = join(root, "output");
    const keepVideo = join(libraryDir, "ABC-123.mp4");
    const skippedVideo = join(outputDir, "XYZ-999.mp4");

    await mkdir(libraryDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });
    await writeFile(keepVideo, "keep");
    await writeFile(skippedVideo, "skip");

    const handlers = createFileHandlers(createContext());
    const result = await handlers[IpcChannel.File_ListMediaCandidates].action(
      actionArgs({ dirPath: root, excludeDirPaths: [outputDir] }),
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toEqual(
      expect.objectContaining({
        path: keepVideo,
        relativePath: join("library", "ABC-123.mp4"),
      }),
    );
  });

  it("does not exclude the entire scan root when excludeDirPaths matches the root", async () => {
    const root = await createTempDir();
    const videoPath = join(root, "ABC-123.mp4");

    await writeFile(videoPath, "video");

    const handlers = createFileHandlers(createContext());
    const result = await handlers[IpcChannel.File_ListMediaCandidates].action(
      actionArgs({ dirPath: root, excludeDirPaths: [root] }),
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toEqual(
      expect.objectContaining({
        path: videoPath,
      }),
    );
  });
  it("applies configured NFO fields when manually saving metadata", async () => {
    const root = await createTempDir();
    const nfoPath = join(root, "ABC-123.nfo");
    vi.mocked(configManager.getValidated).mockResolvedValue({
      ...defaultConfiguration,
      download: {
        ...defaultConfiguration.download,
        nfoIgnoreFields: ["director"],
      },
    });

    const handlers = createFileHandlers(createContext());
    await handlers[IpcChannel.File_NfoWrite].action(
      actionArgs({
        nfoPath,
        data: {
          title: "Manual NFO",
          number: "ABC-123",
          actors: [],
          genres: [],
          director: "Director",
          trailer_url: "https://example.com/trailer.mp4",
          trailer_source_url: "https://example.com/trailer-source.mp4",
          scene_images: [],
          website: Website.JAVDB,
        },
      }),
    );

    const xml = await readFile(nfoPath, "utf8");
    expect(xml).not.toContain("<director>Director</director>");
    expect(xml).toContain("<trailer>");
    expect(xml).toContain("trailer_source_url");
  });

  it.each([
    {
      label: "two typed uniqueid nodes",
      identifiers: '<uniqueid type="dmm">ABC-123</uniqueid><uniqueid type="javdb">ABC-123</uniqueid>',
      website: Website.DMM,
    },
    {
      label: "a typed uniqueid alongside an untyped one",
      identifiers: '<uniqueid type="dmm">ABC-123</uniqueid><uniqueid>external-id</uniqueid>',
      website: Website.DMM,
    },
    {
      label: "an MDCx num plus provider tag",
      identifiers: "<num>ABC-123</num><javdbid>external-id</javdbid>",
      website: Website.JAVDB,
    },
    {
      label: "an MDCx num with no recognizable source",
      identifiers: "<num>ABC-123</num>",
      website: undefined,
    },
  ])("reads an NFO carrying $label", async ({ identifiers, website }) => {
    const root = await createTempDir();
    const nfoPath = join(root, "movie.nfo");
    await writeFile(
      nfoPath,
      `<?xml version="1.0"?><movie><title>Example</title>${identifiers}<actor><name>Actor A</name></actor></movie>`,
    );

    const handlers = createFileHandlers(createContext());
    const readResult = await handlers[IpcChannel.File_NfoRead].action(actionArgs({ nfoPath }));

    expect(readResult.data).toMatchObject({ number: "ABC-123", title: "Example", actors: ["Actor A"] });
    expect(readResult.data.website).toBe(website);
  });

  it("resolves filename NFO mode and preserves unmanaged XML while saving", async () => {
    const root = await createTempDir();
    const videoPath = join(root, "ABC-123.mp4");
    const filenameNfoPath = join(root, "ABC-123.nfo");
    await writeFile(videoPath, "video");
    await writeFile(
      filenameNfoPath,
      '<?xml version="1.0"?><movie custom="keep"><title>Old</title><originaltitle>Old</originaltitle><uniqueid type="javdb" default="true">ABC-123</uniqueid><actor role="lead"><name>Actor A</name></actor><providerid source="local">keep-me</providerid></movie>',
    );
    vi.mocked(configManager.getValidated).mockResolvedValue({
      ...defaultConfiguration,
      download: { ...defaultConfiguration.download, nfoNaming: "filename" },
    });

    const handlers = createFileHandlers(createContext());
    const readResult = await handlers[IpcChannel.File_NfoRead].action(
      actionArgs({ nfoPath: join(root, "movie.nfo"), videoPath }),
    );
    expect(readResult.nfoPath).toBe(filenameNfoPath);
    expect(readResult.data.actors).toEqual(["Actor A"]);

    await handlers[IpcChannel.File_NfoWrite].action(
      actionArgs({
        nfoPath: readResult.nfoPath,
        videoPath,
        data: { ...readResult.data, title: "New", title_zh: "New" },
      }),
    );
    const savedXml = await readFile(filenameNfoPath, "utf8");
    expect(savedXml).toContain("<title>New</title>");
    expect(savedXml).toContain('<movie custom="keep">');
    expect(savedXml).toContain('<actor role="lead">');
    expect(savedXml).toContain('<providerid source="local">keep-me</providerid>');
    await expect(readFile(join(root, "movie.nfo"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("prepares and saves a poster crop from configured local assets", async () => {
    const root = await createTempDir();
    const videoPath = join(root, "ABC-123.mp4");
    const thumbPath = join(root, "thumb.jpg");
    await writeFile(videoPath, "video");
    await writeFile(
      thumbPath,
      '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500"><rect width="100%" height="100%" fill="#c84630"/></svg>',
    );
    const handlers = createFileHandlers(createContext());
    const session = await handlers[IpcChannel.File_PosterCropSession].action(actionArgs({ videoPath }));
    expect(session).toMatchObject({
      sourcePath: thumbPath,
      targetPath: join(root, "poster.jpg"),
      width: 900,
      height: 500,
    });

    const saved = await handlers[IpcChannel.File_PosterCropSave].action(
      actionArgs({ videoPath, crop: session.initialCrop }),
    );
    expect(saved.revision).toEqual(expect.any(String));
    expect((await readFile(saved.targetPath)).length).toBeGreaterThan(0);
  });
});

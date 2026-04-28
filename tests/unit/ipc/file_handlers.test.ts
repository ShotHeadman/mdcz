import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServiceContainer } from "@main/container";
import { createFileHandlers } from "@main/ipc/handlers/file";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
    );
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
      actionArgs({ dirPath: root, excludeDirPath: outputDir }),
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toEqual(
      expect.objectContaining({
        path: keepVideo,
        relativePath: join("library", "ABC-123.mp4"),
      }),
    );
  });

  it("does not exclude the entire scan root when excludeDirPath matches the root", async () => {
    const root = await createTempDir();
    const videoPath = join(root, "ABC-123.mp4");

    await writeFile(videoPath, "video");

    const handlers = createFileHandlers(createContext());
    const result = await handlers[IpcChannel.File_ListMediaCandidates].action(
      actionArgs({ dirPath: root, excludeDirPath: root }),
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toEqual(
      expect.objectContaining({
        path: videoPath,
      }),
    );
  });
});

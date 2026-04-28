import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServiceContainer } from "@main/container";
import { createOverviewHandlers } from "@main/ipc/handlers/overview";
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

const actionArgs = { context: { sender: {} as never }, input: undefined };

const createContext = (overrides: {
  list?: ReturnType<typeof vi.fn>;
  getThumbnailPath?: (number: string) => string;
  getSummary?: ReturnType<typeof vi.fn>;
}): ServiceContainer =>
  ({
    recentAcquisitionsStore: {
      list: overrides.list ?? vi.fn(async () => []),
      getThumbnailPath: overrides.getThumbnailPath ?? ((number: string) => `/missing/${number}.webp`),
    },
    outputLibraryScanner: {
      getSummary:
        overrides.getSummary ?? vi.fn(async () => ({ fileCount: 0, totalBytes: 0, scannedAt: 0, rootPath: null })),
    },
  }) as unknown as ServiceContainer;

describe("createOverviewHandlers", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("returns thumbnail absolute paths only when the thumbnail file exists", async () => {
    const thumbnailDir = await mkdtemp(join(tmpdir(), "mdcz-overview-ipc-"));
    tempDirs.push(thumbnailDir);
    const existingThumbnailPath = join(thumbnailDir, "ABC-123.webp");
    await writeFile(existingThumbnailPath, "thumbnail");

    const handlers = createOverviewHandlers(
      createContext({
        list: vi.fn(async () => [
          {
            number: "ABC-123",
            title: "First",
            actors: ["Actor A"],
            lastKnownPath: "/output/ABC-123.mp4",
            completedAt: 1_700_000_000_000,
          },
          {
            number: "MISSING-1",
            title: null,
            actors: [],
            lastKnownPath: null,
            completedAt: 1_700_000_000_001,
          },
        ]),
        getThumbnailPath: (number) => join(thumbnailDir, `${number}.webp`),
      }),
    );

    await expect(handlers[IpcChannel.Overview_GetRecentAcquisitions].action(actionArgs)).resolves.toEqual({
      items: [
        {
          number: "ABC-123",
          title: "First",
          actors: ["Actor A"],
          thumbnailPath: existingThumbnailPath,
          lastKnownPath: "/output/ABC-123.mp4",
          completedAt: 1_700_000_000_000,
        },
        {
          number: "MISSING-1",
          title: null,
          actors: [],
          thumbnailPath: null,
          lastKnownPath: null,
          completedAt: 1_700_000_000_001,
        },
      ],
    });
  });

  it("delegates output summary requests to the scanner", async () => {
    const summary = {
      fileCount: 3,
      totalBytes: 4096,
      scannedAt: 1_700_000_000_000,
      rootPath: "/output",
    };
    const getSummary = vi.fn(async () => summary);
    const handlers = createOverviewHandlers(createContext({ getSummary }));

    await expect(handlers[IpcChannel.Overview_GetOutputSummary].action(actionArgs)).resolves.toEqual(summary);
    expect(getSummary).toHaveBeenCalledOnce();
  });

  it("wraps overview handler failures as serializable IPC errors", async () => {
    const handlers = createOverviewHandlers(
      createContext({
        list: vi.fn(async () => {
          throw new Error("boom");
        }),
      }),
    );

    await expect(handlers[IpcChannel.Overview_GetRecentAcquisitions].action(actionArgs)).rejects.toMatchObject({
      code: "Error",
      message: "boom",
    });
  });
});

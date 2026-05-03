import type { ServiceContainer } from "@main/container";
import { createOverviewHandlers } from "@main/ipc/handlers/overview";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import { describe, expect, it, vi } from "vitest";

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
  listEntries?: ReturnType<typeof vi.fn>;
  getSummary?: ReturnType<typeof vi.fn>;
}): ServiceContainer =>
  ({
    persistenceService: {
      getState: vi.fn(async () => ({
        repositories: {
          library: {
            listEntries: overrides.listEntries ?? vi.fn(async () => []),
          },
        },
      })),
    },
    outputLibraryScanner: {
      getSummary:
        overrides.getSummary ?? vi.fn(async () => ({ fileCount: 0, totalBytes: 0, scannedAt: 0, rootPath: null })),
    },
  }) as unknown as ServiceContainer;

describe("createOverviewHandlers", () => {
  it("returns persisted library entries as recent acquisitions", async () => {
    const handlers = createOverviewHandlers(
      createContext({
        listEntries: vi.fn(async () => [
          {
            id: "entry-1",
            number: "ABC-123",
            fileName: "ABC-123.mp4",
            title: "First",
            actors: ["Actor A"],
            thumbnailPath: "/persisted/ABC-123.webp",
            lastKnownPath: "/output/ABC-123.mp4",
            indexedAt: new Date(1_700_000_000_000),
          },
          {
            id: "entry-2",
            number: "MISSING-1",
            fileName: "MISSING-1.mp4",
            title: null,
            actors: [],
            thumbnailPath: null,
            lastKnownPath: null,
            indexedAt: new Date(1_700_000_000_001),
          },
        ]),
      }),
    );

    await expect(handlers[IpcChannel.Overview_GetRecentAcquisitions].action(actionArgs)).resolves.toEqual({
      items: [
        {
          number: "MISSING-1",
          title: null,
          actors: [],
          thumbnailPath: null,
          lastKnownPath: null,
          completedAt: 1_700_000_000_001,
        },
        {
          number: "ABC-123",
          title: "First",
          actors: ["Actor A"],
          thumbnailPath: "/persisted/ABC-123.webp",
          lastKnownPath: "/output/ABC-123.mp4",
          completedAt: 1_700_000_000_000,
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

  it("returns an empty recent-acquisition list when persistence has no entries", async () => {
    const handlers = createOverviewHandlers(createContext({ listEntries: vi.fn(async () => []) }));

    await expect(handlers[IpcChannel.Overview_GetRecentAcquisitions].action(actionArgs)).resolves.toEqual({
      items: [],
    });
  });

  it("sorts and limits persisted recent acquisitions", async () => {
    const entries = Array.from({ length: 55 }, (_, index) => {
      const displayIndex = String(index).padStart(2, "0");
      return {
        id: `entry-${displayIndex}`,
        number: `ABC-${displayIndex}`,
        fileName: `ABC-${displayIndex}.mp4`,
        title: `Persisted ${displayIndex}`,
        actors: ["Actor P"],
        thumbnailPath: `/persisted/thumb-${displayIndex}.png`,
        lastKnownPath: `/persisted/ABC-${displayIndex}.mp4`,
        indexedAt: new Date(1_700_000_000_000 + index),
      };
    });
    const handlers = createOverviewHandlers(
      createContext({
        listEntries: vi.fn(async () => entries),
      }),
    );

    const result = await handlers[IpcChannel.Overview_GetRecentAcquisitions].action(actionArgs);

    expect(result.items).toHaveLength(50);
    expect(result.items[0]).toEqual({
      number: "ABC-54",
      title: "Persisted 54",
      actors: ["Actor P"],
      thumbnailPath: "/persisted/thumb-54.png",
      lastKnownPath: "/persisted/ABC-54.mp4",
      completedAt: 1_700_000_000_054,
    });
    expect(result.items.at(-1)?.number).toBe("ABC-05");
  });

  it("wraps overview handler failures as serializable IPC errors", async () => {
    const handlers = createOverviewHandlers(
      createContext({
        listEntries: vi.fn(async () => {
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

import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { ServiceContainer } from "@main/container";
import { createAppHandlers } from "@main/ipc/handlers/app";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ipcActionArgs } from "./ipcActionArgs";

const { mockExit, mockOpenPath, mockRelaunch, mockShowItemInFolder, mockUserDataPath } = vi.hoisted(() => ({
  mockExit: vi.fn(),
  mockOpenPath: vi.fn(),
  mockRelaunch: vi.fn(),
  mockShowItemInFolder: vi.fn(),
  mockUserDataPath: `${process.cwd()}/.tmp/mdcz-vitest-app-handlers-${process.pid}`,
}));

vi.mock("electron", () => {
  return {
    app: {
      exit: mockExit,
      getPath: () => mockUserDataPath,
      getVersion: () => "0.0.0-test",
      isReady: () => false,
      relaunch: mockRelaunch,
      setAppUserModelId: vi.fn(),
      commandLine: {
        appendSwitch: vi.fn(),
      },
    },
    shell: {
      openExternal: vi.fn(),
      openPath: mockOpenPath,
      showItemInFolder: mockShowItemInFolder,
    },
    ipcMain: {
      handle: vi.fn(),
      once: vi.fn(),
      removeHandler: vi.fn(),
    },
  };
});

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

const actionArgs = ipcActionArgs(undefined);

const createContext = (
  syncTitleBarOverlay = vi.fn(),
  roots: Array<{ id: string; hostPath: string }> = [],
): ServiceContainer =>
  ({
    windowService: {
      syncTitleBarOverlay,
    },
    persistenceService: {
      getState: async () => ({ repositories: { mediaRoots: { list: async () => roots } } }),
    },
  }) as unknown as ServiceContainer;

describe("createAppHandlers", () => {
  beforeEach(() => {
    mockExit.mockClear();
    mockOpenPath.mockReset();
    mockOpenPath.mockResolvedValue("");
    mockRelaunch.mockClear();
    mockShowItemInFolder.mockClear();
  });

  it("ensures and opens the app-managed watermark directory", async () => {
    const handlers = createAppHandlers(createContext());
    const watermarkPath = join(mockUserDataPath, "watermark");

    await expect(handlers[IpcChannel.App_EnsureWatermarkDirectory].action(actionArgs)).resolves.toEqual({
      path: watermarkPath,
    });
    expect((await stat(watermarkPath)).isDirectory()).toBe(true);

    await expect(handlers[IpcChannel.App_OpenWatermarkDirectory].action(actionArgs)).resolves.toEqual({
      success: true,
    });
    expect(mockOpenPath).toHaveBeenCalledWith(watermarkPath);
  });

  it("relaunches the app and exits the current process", async () => {
    const handlers = createAppHandlers(createContext());

    await expect(handlers[IpcChannel.App_Relaunch].action(actionArgs)).resolves.toEqual({ success: true });
    expect(mockRelaunch).toHaveBeenCalledOnce();
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("delegates titlebar theme sync to the window service", async () => {
    const syncTitleBarOverlay = vi.fn();
    const handlers = createAppHandlers(createContext(syncTitleBarOverlay));

    await expect(
      handlers[IpcChannel.App_SyncTitleBarTheme].action({
        ...ipcActionArgs({ isDark: true }),
      }),
    ).resolves.toEqual({ success: true });
    expect(syncTitleBarOverlay).toHaveBeenCalledWith(true);
  });

  it("resolves a root-scoped file before showing it in the system file manager", async () => {
    const rootPath = join(mockUserDataPath, "library");
    const handlers = createAppHandlers(createContext(vi.fn(), [{ id: "media", hostPath: rootPath }]));

    await expect(
      handlers[IpcChannel.App_ShowItemInFolder].action(
        ipcActionArgs({ path: { rootId: "media", relativePath: "ABC-123/ABC-123.mp4" } }),
      ),
    ).resolves.toEqual({ success: true });
    expect(mockShowItemInFolder).toHaveBeenCalledWith(join(rootPath, "ABC-123", "ABC-123.mp4"));
  });

  it("rejects non-http schemes for openExternal", async () => {
    const handlers = createAppHandlers(createContext());
    await expect(
      handlers[IpcChannel.App_OpenExternal].action(ipcActionArgs({ url: "javascript:alert(1)" })),
    ).rejects.toThrow("Unsupported external URL scheme");
    await expect(
      handlers[IpcChannel.App_OpenExternal].action(ipcActionArgs({ url: "file:///etc/passwd" })),
    ).rejects.toThrow("Unsupported external URL scheme");
  });
});

import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { ServiceContainer } from "@main/container";
import { createAppHandlers } from "@main/ipc/handlers/app";
import { IpcChannel } from "@shared/IpcChannel";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExit, mockOpenPath, mockRelaunch, mockUserDataPath } = vi.hoisted(() => ({
  mockExit: vi.fn(),
  mockOpenPath: vi.fn(),
  mockRelaunch: vi.fn(),
  mockUserDataPath: "/tmp/mdcz-vitest-app-handlers",
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

const actionArgs = { context: { sender: {} as never }, input: undefined };

const createContext = (syncTitleBarOverlay = vi.fn()): ServiceContainer =>
  ({
    windowService: {
      syncTitleBarOverlay,
    },
  }) as unknown as ServiceContainer;

describe("createAppHandlers", () => {
  beforeEach(() => {
    mockExit.mockClear();
    mockOpenPath.mockReset();
    mockOpenPath.mockResolvedValue("");
    mockRelaunch.mockClear();
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
        ...actionArgs,
        input: { isDark: true },
      }),
    ).resolves.toEqual({ success: true });
    expect(syncTitleBarOverlay).toHaveBeenCalledWith(true);
  });
});

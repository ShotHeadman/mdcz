import type { ServiceContainer } from "@main/container";
import { createAppHandlers } from "@main/ipc/handlers/app";
import { IpcChannel } from "@shared/IpcChannel";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExit, mockRelaunch } = vi.hoisted(() => ({
  mockExit: vi.fn(),
  mockRelaunch: vi.fn(),
}));

vi.mock("electron", () => {
  return {
    app: {
      exit: mockExit,
      getPath: () => "/tmp/mdcz-vitest-app-handlers",
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
      openPath: vi.fn(),
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
    mockRelaunch.mockClear();
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

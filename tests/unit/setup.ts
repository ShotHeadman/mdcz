import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

const userDataPath = join(tmpdir(), "mdcz-vitest", String(process.pid));

vi.mock("electron", () => {
  const app = {
    isReady: () => false,
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: () => userDataPath,
    commandLine: {
      appendSwitch: () => {},
    },
    setAppUserModelId: () => {},
  };

  const ipcMain = {
    handle: () => {},
    once: () => {},
    removeHandler: () => {},
  };

  return {
    app,
    ipcMain,
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

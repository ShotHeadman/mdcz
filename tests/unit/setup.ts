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
    getVersion: () => "0.0.0-test",
    commandLine: {
      appendSwitch: () => {},
    },
    setAppUserModelId: () => {},
  };

  return {
    app,
    ipcMain: {
      handle: () => {},
      once: () => {},
      removeHandler: () => {},
    },
    shell: {
      openExternal: async () => "",
      openPath: async () => "",
      showItemInFolder: () => {},
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
    },
    nativeImage: {
      createFromPath: () => ({}),
    },
    nativeTheme: {
      shouldUseDarkColors: false,
    },
    net: {
      fetch,
    },
    protocol: {
      registerSchemesAsPrivileged: () => {},
      handle: () => {},
    },
    contextBridge: {
      exposeInMainWorld: () => {},
    },
    ipcRenderer: {
      invoke: async () => undefined,
      on: () => {},
      off: () => {},
      removeListener: () => {},
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

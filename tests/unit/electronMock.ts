import { tmpdir } from "node:os";
import { join } from "node:path";

const userDataPath = join(tmpdir(), "mdcz-vitest", String(process.pid));

export const app = {
  isReady: () => false,
  isPackaged: false,
  getAppPath: () => process.cwd(),
  getPath: () => userDataPath,
  getVersion: () => "0.0.0-test",
  commandLine: {
    appendSwitch: () => {},
  },
  setAppUserModelId: () => {},
  exit: () => {},
  relaunch: () => {},
};

export const ipcMain = {
  handle: () => {},
  once: () => {},
  removeHandler: () => {},
};

export const shell = {
  openExternal: async () => "",
  openPath: async () => "",
};

export const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
};

export const BrowserWindow = {
  getAllWindows: () => [],
};

export const nativeImage = {
  createFromPath: () => ({}),
};

export const nativeTheme = {
  shouldUseDarkColors: false,
};

export const Menu = {
  buildFromTemplate: () => ({}),
};

export class Tray {
  setToolTip(): void {}
  setContextMenu(): void {}
  destroy(): void {}
}

export const net = {
  fetch: fetch,
};

export const protocol = {
  registerSchemesAsPrivileged: () => {},
  handle: () => {},
};

export const contextBridge = {
  exposeInMainWorld: () => {},
};

export const ipcRenderer = {
  invoke: async () => undefined,
  on: () => {},
  off: () => {},
};

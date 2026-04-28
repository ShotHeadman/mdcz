import { existsSync } from "node:fs";
import { join } from "node:path";

import { app, BrowserWindow, nativeImage, nativeTheme } from "electron";
import windowStateKeeper from "electron-window-state";

import iconPath from "../../../build/icon.png?asset";
import {
  buildTitleBarOverlay,
  resolveCustomTitleBarWindowOptions,
  shouldSyncTitleBarOverlay,
} from "./windowTitleBarOptions";

const appIcon = nativeImage.createFromPath(iconPath);

const DEFAULT_WINDOW_WIDTH = 1100;
const DEFAULT_WINDOW_HEIGHT = 750;
const MIN_WINDOW_WIDTH = 900;
const MIN_WINDOW_HEIGHT = 640;
const DEFAULT_RENDERER_ROUTE = "/overview";

export interface MainWindowCreationOptions {
  useCustomTitleBar: boolean;
}

const resolvePreloadPath = (): string => {
  const candidates = ["../preload/index.js", "../preload/index.cjs", "../preload/index.mjs"];

  for (const candidate of candidates) {
    const absolutePath = join(__dirname, candidate);

    if (existsSync(absolutePath)) {
      return absolutePath;
    }
  }

  return join(__dirname, "../preload/index.js");
};

export class WindowService {
  private mainWindow: BrowserWindow | null = null;

  private useCustomTitleBar = false;

  createMainWindow(options: MainWindowCreationOptions): BrowserWindow {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      return this.mainWindow;
    }

    const state = windowStateKeeper({
      defaultWidth: DEFAULT_WINDOW_WIDTH,
      defaultHeight: DEFAULT_WINDOW_HEIGHT,
    });
    const preloadPath = resolvePreloadPath();

    const mainWindow = new BrowserWindow({
      x: state.x,
      y: state.y,
      width: state.width,
      height: state.height,
      minWidth: MIN_WINDOW_WIDTH,
      minHeight: MIN_WINDOW_HEIGHT,
      show: false,
      autoHideMenuBar: true,
      icon: appIcon,
      ...resolveCustomTitleBarWindowOptions({
        useCustomTitleBar: options.useCustomTitleBar,
        isDark: nativeTheme.shouldUseDarkColors,
      }),
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });

    mainWindow.setMenuBarVisibility(false);
    if (process.platform !== "darwin") {
      mainWindow.removeMenu();
    }

    state.manage(mainWindow);

    mainWindow.once("ready-to-show", () => {
      mainWindow.show();
    });

    mainWindow.on("closed", () => {
      if (this.mainWindow === mainWindow) {
        this.mainWindow = null;
      }
    });

    this.mainWindow = mainWindow;
    this.useCustomTitleBar = options.useCustomTitleBar;

    return mainWindow;
  }

  async loadMainWindow(): Promise<void> {
    const mainWindow = this.getMainWindow();
    if (!mainWindow) {
      throw new Error("Main window has not been created");
    }

    const rendererUrl = process.env.ELECTRON_RENDERER_URL;

    if (rendererUrl) {
      await mainWindow.loadURL(new URL(DEFAULT_RENDERER_ROUTE, rendererUrl).toString());
      return;
    }

    await mainWindow.loadFile(join(__dirname, "../renderer/index.html"), { hash: DEFAULT_RENDERER_ROUTE });
  }

  toggleDevTools(): void {
    const mainWindow = this.getMainWindow();

    if (!mainWindow) {
      return;
    }

    if (mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.webContents.closeDevTools();
    } else {
      mainWindow.webContents.openDevTools();
    }
  }

  getMainWindow(): BrowserWindow | null {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      return this.mainWindow;
    }

    return null;
  }

  showMainWindow(): void {
    const mainWindow = this.getMainWindow();

    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.show();
    mainWindow.focus();
  }

  syncTitleBarOverlay(isDark: boolean): void {
    if (!this.useCustomTitleBar || !shouldSyncTitleBarOverlay()) {
      return;
    }

    const mainWindow = this.getMainWindow();
    if (!mainWindow) {
      return;
    }

    mainWindow.setTitleBarOverlay(buildTitleBarOverlay(isDark));
  }

  applyUiConfig(config: { hideDock: boolean; hideMenu: boolean; hideWindowButtons: boolean }): void {
    // hideDock: macOS only — hide/show the app icon in the Dock
    if (process.platform === "darwin" && app.dock) {
      if (config.hideDock) {
        app.dock.hide();
      } else {
        app.dock.show();
      }
    }

    const mainWindow = this.getMainWindow();
    if (!mainWindow) return;

    // hideMenu: toggle menu bar visibility (all platforms)
    mainWindow.setMenuBarVisibility(!config.hideMenu);
    mainWindow.setAutoHideMenuBar(config.hideMenu);

    // hideWindowButtons: macOS only — toggle traffic light buttons
    if (process.platform === "darwin") {
      mainWindow.setWindowButtonVisibility(!config.hideWindowButtons);
    }
  }
}

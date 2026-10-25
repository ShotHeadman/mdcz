import { arch } from "node:os";
import { resolveRootRelativePath } from "@mdcz/media-store";
import { ensureWatermarkDirectory } from "@mdcz/runtime/scrape";
import { resolvePlayableMediaTarget } from "@mdcz/runtime/scrape/utils/strm";
import type { ServerServices } from "@mdcz/server/services";
import { DESKTOP_BRIDGE_CALLS, type DesktopBridgeCalls } from "@mdcz/shared/desktopBridge";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import { app, dialog, type IpcMainInvokeEvent, ipcMain, shell } from "electron";
import { isTrustedRendererUrl } from "./rendererTrust";
import type { UpdateService } from "./services/UpdateService";
import type { WindowService } from "./services/WindowService";

const openPath = async (path: string): Promise<void> => {
  const error = await shell.openPath(path);
  if (error) throw new Error(error);
};

/** Registers the calls behind `window.mdczDesktop`; only the app's own page may make them. */
export const registerDesktopBridge = (deps: {
  services: ServerServices;
  updateService: UpdateService;
  windowService: WindowService;
}): void => {
  const { services, updateService, windowService } = deps;
  const hostPath = async (file: RootFileRef) =>
    resolveRootRelativePath(await services.mediaRoots.get(file.rootId), file.relativePath);
  const calls: DesktopBridgeCalls = {
    appInfo: async () => ({
      version: app.getVersion(),
      arch: arch(),
      platform: process.platform,
      isPackaged: app.isPackaged,
    }),
    updateStatus: async () => updateService.getStatus(),
    checkForUpdate: async () => await updateService.check(),
    downloadUpdate: async () => await updateService.download(),
    installUpdate: async () => updateService.install(),
    relaunch: async () => {
      app.relaunch();
      app.quit();
    },
    syncTitleBarTheme: async (isDark) => windowService.syncTitleBarOverlay(isDark),
    toggleDevTools: async () => windowService.toggleDevTools(),
    showItemInFolder: async (file) => shell.showItemInFolder(await hostPath(file)),
    playMedia: async (file) => {
      const target = await resolvePlayableMediaTarget(await hostPath(file));
      if (target.kind === "path") return await openPath(target.target);
      if (!/^https?:\/\//iu.test(target.target)) throw new Error(`Unsupported stream URL: ${target.target}`);
      await shell.openExternal(target.target);
    },
    openWatermarkDirectory: async () =>
      await openPath(await ensureWatermarkDirectory(services.config.runtimePaths.dataDir)),
    browse: async (kind, filters) => {
      const window = windowService.getMainWindow();
      const options: Electron.OpenDialogOptions = {
        properties: [kind === "directory" ? "openDirectory" : "openFile"],
        filters,
      };
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
  };
  for (const name of DESKTOP_BRIDGE_CALLS) {
    ipcMain.handle(`desktop:${name}`, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!isTrustedRendererUrl(event.senderFrame?.url ?? "")) throw new Error("Untrusted bridge caller");
      return (calls[name] as (...input: unknown[]) => Promise<unknown>)(...args);
    });
  }
};

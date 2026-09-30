import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";

export const DESKTOP_APP_NAME = "mdcz";

let identityApplied = false;

// NSIS installs place an uninstaller beside the executable; the portable zip ships without one.
export const isWindowsPortable = (): boolean =>
  process.platform === "win32" &&
  app.isPackaged &&
  !existsSync(join(dirname(app.getPath("exe")), "Uninstall MDCz.exe"));

export const applyDesktopAppIdentity = (): void => {
  if (identityApplied) {
    return;
  }

  (app as { setName?: (name: string) => void }).setName?.(DESKTOP_APP_NAME);
  if (isWindowsPortable()) {
    app.setPath("userData", join(dirname(app.getPath("exe")), "data"));
  }
  identityApplied = true;
};

export const getDesktopUserDataPath = (): string => {
  applyDesktopAppIdentity();
  return app.getPath("userData");
};

export const resolveDesktopDataFile = (fileName: string): string => {
  try {
    return join(getDesktopUserDataPath(), fileName);
  } catch {
    return join(process.cwd(), ".tmp", fileName);
  }
};

export const getActorImageCacheDirectory = (): string => resolveDesktopDataFile("actor-image-cache");

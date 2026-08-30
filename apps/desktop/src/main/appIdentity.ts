import { join } from "node:path";
import { app } from "electron";

export const DESKTOP_APP_NAME = "mdcz";

let identityApplied = false;

export const applyDesktopAppIdentity = (): void => {
  if (identityApplied) {
    return;
  }

  (app as { setName?: (name: string) => void }).setName?.(DESKTOP_APP_NAME);
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

import { mkdir } from "node:fs/promises";

import { app } from "electron";

let initialized = false;

const applyCommandLineSwitches = (): void => {
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
};

const applyPlatformDefaults = (): void => {
  if (process.platform === "win32") {
    app.setAppUserModelId("com.shotheadman.mdcz");
  }
};

const ensureUserDataDirectory = async (): Promise<void> => {
  const userDataPath = app.getPath("userData");
  await mkdir(userDataPath, { recursive: true });
};

export const bootstrap = async (): Promise<void> => {
  if (initialized) {
    return;
  }

  applyCommandLineSwitches();
  applyPlatformDefaults();
  await ensureUserDataDirectory();

  initialized = true;
};

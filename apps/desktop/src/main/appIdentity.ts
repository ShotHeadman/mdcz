import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";

// NSIS installs place an uninstaller beside the executable; the portable zip ships without one.
export const isWindowsPortable = (): boolean =>
  process.platform === "win32" &&
  app.isPackaged &&
  !existsSync(join(dirname(app.getPath("exe")), "Uninstall MDCz.exe"));

/** Must run before `app.whenReady()`. Returns the data directory; portable Windows builds keep it beside the executable. */
export const applyDesktopAppIdentity = (): string => {
  app.setName("mdcz");
  if (isWindowsPortable()) {
    app.setPath("userData", join(dirname(app.getPath("exe")), "data"));
  }
  if (process.platform === "win32") {
    app.setAppUserModelId("com.shotheadman.mdcz");
  }
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  return app.getPath("userData");
};

import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, _electron as electron, type Page } from "@playwright/test";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const desktopRoot = path.join(workspaceRoot, "apps", "desktop");

export interface DesktopSession {
  app: ElectronApplication;
  page: Page;
  pageErrors: string[];
}

export const launchDesktop = async (input: { userDataDir: string; mainLogs: string[] }): Promise<DesktopSession> => {
  const launchSwitches = [
    `--user-data-dir=${input.userDataDir}`,
    ...(process.env.CI && process.platform === "linux" ? ["--no-sandbox"] : []),
  ];
  const app = await electron.launch({
    args: [...launchSwitches, desktopRoot],
    cwd: desktopRoot,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: "1",
    },
  });
  const desktopProcess = app.process();
  desktopProcess.stdout?.on("data", (chunk) => input.mainLogs.push(chunk.toString()));
  desktopProcess.stderr?.on("data", (chunk) => input.mainLogs.push(chunk.toString()));
  const page = await app.firstWindow();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
  await page.waitForLoadState("domcontentloaded");
  return { app, page, pageErrors };
};

import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, _electron as electron, expect, type Page, test } from "@playwright/test";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const desktopRoot = path.join(workspaceRoot, "apps", "desktop");
const userDataDir = process.env.MDCZ_E2E_DESKTOP_USER_DATA_DIR;
const desktopMainLogs: string[] = [];

if (!userDataDir) {
  throw new Error("MDCZ_E2E_DESKTOP_USER_DATA_DIR is required. Run Desktop E2E through pnpm test:e2e.");
}

interface DesktopSession {
  app: ElectronApplication;
  page: Page;
  pageErrors: string[];
}

const launchDesktop = async (): Promise<DesktopSession> => {
  const launchSwitches = [
    `--user-data-dir=${userDataDir}`,
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
  desktopProcess.stdout?.on("data", (chunk) => desktopMainLogs.push(chunk.toString()));
  desktopProcess.stderr?.on("data", (chunk) => desktopMainLogs.push(chunk.toString()));
  const page = await app.firstWindow();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
  await page.waitForLoadState("domcontentloaded");
  return { app, page, pageErrors };
};

const invoke = async <T>(page: Page, channel: string, payload?: unknown): Promise<T> =>
  (await page.evaluate(
    async ({ channel: ipcChannel, payload: ipcPayload }) => await window.api.invoke(ipcChannel as never, ipcPayload),
    { channel, payload },
  )) as T;

test.describe
  .serial("Desktop product smoke", () => {
    let session: DesktopSession;

    test.beforeAll(async () => {
      session = await launchDesktop();
    });

    test.afterAll(async ({ playwright: _playwright }, testInfo) => {
      if (session) {
        await session.app.close();
      }
      const mainLogText = desktopMainLogs.join("");
      await testInfo.attach("desktop-main.log", {
        body: Buffer.from(mainLogText || "No Electron main-process stdout/stderr captured.\n", "utf8"),
        contentType: "text/plain",
      });
      expect(mainLogText).not.toMatch(/Failed to initialize main process|UnhandledPromiseRejection|FATAL/iu);
    });

    test("starts the built Electron application with a visible main window", async () => {
      await expect(session.page.getByRole("link", { name: "设置" })).toBeVisible();
      expect(await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
      expect(session.pageErrors).toEqual([]);
    });

    test("exposes the preload bridge and completes a typed main-process IPC round trip", async () => {
      const bridge = await session.page.evaluate(() => ({
        electronOpenPath: typeof window.electron?.openPath,
        invoke: typeof window.api?.invoke,
        on: typeof window.api?.on,
      }));
      const appInfo = await invoke<{ isPackaged: boolean; platform: string; version: string }>(
        session.page,
        "app:info",
      );

      expect(bridge).toEqual({ electronOpenPath: "function", invoke: "function", on: "function" });
      expect(appInfo).toMatchObject({ isPackaged: false, platform: process.platform });
      expect(appInfo.version).toMatch(/^\d+\.\d+\.\d+/u);
      expect(session.pageErrors).toEqual([]);
    });

    test("persists a setting through renderer, preload, IPC, and an application restart", async () => {
      await session.page.getByRole("link", { name: "设置" }).click();
      const search = session.page.getByRole("combobox");
      await search.fill("并发线程数");
      const threadCount = session.page.getByRole("spinbutton");
      await expect(threadCount).toBeVisible();
      await threadCount.fill("6");
      await threadCount.press("Enter");
      await expect.poll(() => invoke<number>(session.page, "config:get", { path: "scrape.threadNumber" })).toBe(6);

      await session.app.close();
      session = await launchDesktop();
      await session.page.getByRole("link", { name: "设置" }).click();
      await session.page.getByRole("combobox").fill("并发线程数");
      await expect(session.page.getByRole("spinbutton")).toHaveValue("6");
      expect(session.pageErrors).toEqual([]);
    });
  });

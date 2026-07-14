import { expect, test } from "@playwright/test";
import { runCrawlerLiveCatalog } from "../live/run-crawler-live-catalog";
import { type DesktopSession, launchDesktop } from "./desktop-harness";

const userDataDir = process.env.MDCZ_E2E_DESKTOP_USER_DATA_DIR;
const desktopMainLogs: string[] = [];

if (!userDataDir) {
  throw new Error(
    "MDCZ_E2E_DESKTOP_USER_DATA_DIR is required. Run Desktop live E2E through pnpm test:e2e:live:desktop.",
  );
}

test.describe
  .serial("Desktop crawler external E2E/live", () => {
    let session: DesktopSession;

    test.beforeAll(async () => {
      session = await launchDesktop({ userDataDir, mainLogs: desktopMainLogs });
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

    test("runs the public crawler catalog through the built Desktop product", async ({
      playwright: _playwright,
    }, testInfo) => {
      test.setTimeout(15 * 60_000);
      await runCrawlerLiveCatalog({ page: session.page, target: "desktop", testInfo });
      expect(session.pageErrors).toEqual([]);
    });
  });

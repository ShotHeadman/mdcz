import { expect, test } from "@playwright/test";
import { createWorkbenchMediaFixture, createWorkbenchRefreshMediaFixture } from "../../live/workbench-fixture";
import { runReportedWorkbenchJourney } from "../live/reported-workbench-journey";
import { runWorkbenchRefreshJourney, WORKBENCH_REFRESH_JOURNEY_TIMEOUT_MS } from "../live/workbench-refresh-journey";
import { runWorkbenchScrapeJourney, WORKBENCH_SCRAPE_JOURNEY_TIMEOUT_MS } from "../live/workbench-scrape-journey";
import { type DesktopSession, launchDesktop } from "./desktop-harness";

const userDataDir = process.env.MDCZ_E2E_DESKTOP_USER_DATA_DIR;
const desktopMainLogs: string[] = [];

if (!userDataDir) {
  throw new Error(
    "MDCZ_E2E_DESKTOP_USER_DATA_DIR is required. Run Desktop live E2E through pnpm test:live or node tests/e2e/web/run.mjs --live --project=desktop-electron.",
  );
}

test.describe
  .serial("Desktop workbench E2E/live", () => {
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

    test("scrapes the workbench representative case through the built Desktop product", async ({
      playwright: _playwright,
    }, testInfo) => {
      test.setTimeout(WORKBENCH_SCRAPE_JOURNEY_TIMEOUT_MS);
      await runReportedWorkbenchJourney({
        testInfo,
        target: "desktop",
        phase: "workbench-scrape",
        reportBaseName: "desktop-workbench-scrape-live-report",
        createFixture: (liveCase) =>
          createWorkbenchMediaFixture({
            target: "desktop",
            journey: "scrape-live",
            number: liveCase.number,
          }),
        run: async ({ liveCase, fixture }) => {
          const summary = await runWorkbenchScrapeJourney({
            page: session.page,
            target: "desktop",
            liveCase,
            fixture,
            timeoutMs: WORKBENCH_SCRAPE_JOURNEY_TIMEOUT_MS,
          });
          expect(session.pageErrors).toEqual([]);
          return summary;
        },
        onFailure: async () => {
          if (session.pageErrors.length > 0) {
            await testInfo.attach("desktop-page-errors.log", {
              body: Buffer.from(`${session.pageErrors.join("\n")}\n`, "utf8"),
              contentType: "text/plain",
            });
          }
        },
      });
    });

    test("refreshes seeded NFO data through the built Desktop product", async ({
      playwright: _playwright,
    }, testInfo) => {
      test.setTimeout(WORKBENCH_REFRESH_JOURNEY_TIMEOUT_MS);
      await runReportedWorkbenchJourney({
        testInfo,
        target: "desktop",
        phase: "workbench-refresh",
        reportBaseName: "desktop-workbench-refresh-live-report",
        createFixture: (liveCase) =>
          createWorkbenchRefreshMediaFixture({
            target: "desktop",
            number: liveCase.number,
          }),
        run: async ({ liveCase, fixture }) => {
          const summary = await runWorkbenchRefreshJourney({
            page: session.page,
            target: "desktop",
            liveCase,
            fixture,
            timeoutMs: WORKBENCH_REFRESH_JOURNEY_TIMEOUT_MS,
          });
          expect(session.pageErrors).toEqual([]);
          return summary;
        },
        onFailure: async () => {
          if (session.pageErrors.length > 0) {
            await testInfo.attach("desktop-page-errors.log", {
              body: Buffer.from(`${session.pageErrors.join("\n")}\n`, "utf8"),
              contentType: "text/plain",
            });
          }
        },
      });
    });
  });

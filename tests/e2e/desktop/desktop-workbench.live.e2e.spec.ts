import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { LIVE_CATALOG_VERSION, resolveWorkbenchLiveCase } from "../../live/catalog";
import { buildLiveReport, failedLiveCase, passedLiveCase } from "../../live/report";
import { createWorkbenchMediaFixture, createWorkbenchRefreshMediaFixture } from "../../live/workbench-fixture";
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
      const liveCase = resolveWorkbenchLiveCase();
      const fixture = createWorkbenchMediaFixture({
        target: "desktop",
        journey: "scrape-live",
        number: liveCase.number,
      });
      const startedAt = new Date();
      const caseStartedAt = Date.now();

      try {
        const summary = await runWorkbenchScrapeJourney({
          page: session.page,
          target: "desktop",
          liveCase,
          fixture,
          timeoutMs: WORKBENCH_SCRAPE_JOURNEY_TIMEOUT_MS,
        });
        expect(session.pageErrors).toEqual([]);
        const result = passedLiveCase({
          liveCase,
          layer: "e2e",
          target: "desktop",
          phase: "workbench-scrape",
          durationMs: Date.now() - caseStartedAt,
          summary,
        });
        const report = buildLiveReport({
          catalogVersion: LIVE_CATALOG_VERSION,
          layer: "e2e",
          target: "desktop",
          appVersion: process.env.MDCZ_APP_VERSION ?? "unknown",
          commit: process.env.GITHUB_SHA ?? process.env.MDCZ_GIT_COMMIT,
          startedAt,
          finishedAt: new Date(),
          cases: [result],
        });
        const reportPath = testInfo.outputPath("desktop-workbench-scrape-live-report.json");
        await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
        await testInfo.attach("desktop-workbench-scrape-live-report", {
          path: reportPath,
          contentType: "application/json",
        });
      } catch (error) {
        const result = failedLiveCase({
          liveCase,
          layer: "e2e",
          target: "desktop",
          phase: "workbench-scrape",
          durationMs: Date.now() - caseStartedAt,
          error,
        });
        const report = buildLiveReport({
          catalogVersion: LIVE_CATALOG_VERSION,
          layer: "e2e",
          target: "desktop",
          appVersion: process.env.MDCZ_APP_VERSION ?? "unknown",
          commit: process.env.GITHUB_SHA ?? process.env.MDCZ_GIT_COMMIT,
          startedAt,
          finishedAt: new Date(),
          cases: [result],
        });
        const reportPath = testInfo.outputPath("desktop-workbench-scrape-live-report.json");
        await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
        await testInfo.attach("desktop-workbench-scrape-live-report", {
          path: reportPath,
          contentType: "application/json",
        });
        if (session.pageErrors.length > 0) {
          await testInfo.attach("desktop-page-errors.log", {
            body: Buffer.from(`${session.pageErrors.join("\n")}\n`, "utf8"),
            contentType: "text/plain",
          });
        }
        throw error;
      } finally {
        await fixture.cleanup();
      }
    });

    test("refreshes seeded NFO data through the built Desktop product", async ({
      playwright: _playwright,
    }, testInfo) => {
      test.setTimeout(WORKBENCH_REFRESH_JOURNEY_TIMEOUT_MS);
      const liveCase = resolveWorkbenchLiveCase();
      const fixture = createWorkbenchRefreshMediaFixture({
        target: "desktop",
        number: liveCase.number,
      });
      const startedAt = new Date();
      const caseStartedAt = Date.now();

      try {
        const summary = await runWorkbenchRefreshJourney({
          page: session.page,
          target: "desktop",
          liveCase,
          fixture,
          timeoutMs: WORKBENCH_REFRESH_JOURNEY_TIMEOUT_MS,
        });
        expect(session.pageErrors).toEqual([]);
        const result = passedLiveCase({
          liveCase,
          layer: "e2e",
          target: "desktop",
          phase: "workbench-refresh",
          durationMs: Date.now() - caseStartedAt,
          summary,
        });
        const report = buildLiveReport({
          catalogVersion: LIVE_CATALOG_VERSION,
          layer: "e2e",
          target: "desktop",
          appVersion: process.env.MDCZ_APP_VERSION ?? "unknown",
          commit: process.env.GITHUB_SHA ?? process.env.MDCZ_GIT_COMMIT,
          startedAt,
          finishedAt: new Date(),
          cases: [result],
        });
        const reportPath = testInfo.outputPath("desktop-workbench-refresh-live-report.json");
        await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
        await testInfo.attach("desktop-workbench-refresh-live-report", {
          path: reportPath,
          contentType: "application/json",
        });
      } catch (error) {
        const result = failedLiveCase({
          liveCase,
          layer: "e2e",
          target: "desktop",
          phase: "workbench-refresh",
          durationMs: Date.now() - caseStartedAt,
          error,
        });
        const report = buildLiveReport({
          catalogVersion: LIVE_CATALOG_VERSION,
          layer: "e2e",
          target: "desktop",
          appVersion: process.env.MDCZ_APP_VERSION ?? "unknown",
          commit: process.env.GITHUB_SHA ?? process.env.MDCZ_GIT_COMMIT,
          startedAt,
          finishedAt: new Date(),
          cases: [result],
        });
        const reportPath = testInfo.outputPath("desktop-workbench-refresh-live-report.json");
        await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
        await testInfo.attach("desktop-workbench-refresh-live-report", {
          path: reportPath,
          contentType: "application/json",
        });
        if (session.pageErrors.length > 0) {
          await testInfo.attach("desktop-page-errors.log", {
            body: Buffer.from(`${session.pageErrors.join("\n")}\n`, "utf8"),
            contentType: "text/plain",
          });
        }
        throw error;
      } finally {
        await fixture.cleanup();
      }
    });
  });

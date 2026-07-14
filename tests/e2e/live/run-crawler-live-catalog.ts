import { writeFile } from "node:fs/promises";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { CRAWLER_LIVE_CASES, CRAWLER_LIVE_CATALOG_VERSION } from "./crawler-live-catalog";
import {
  buildCrawlerLiveReport,
  type CrawlerLiveCaseResult,
  type CrawlerLiveTarget,
  failedCrawlerLiveCase,
  passedCrawlerLiveCase,
} from "./crawler-live-report";
import { runCrawlerTesterJourney } from "./crawler-tester-journey";

export const runCrawlerLiveCatalog = async (input: {
  page: Page;
  target: CrawlerLiveTarget;
  testInfo: TestInfo;
}): Promise<void> => {
  const startedAt = new Date();
  const results: CrawlerLiveCaseResult[] = [];
  const enabledCases = CRAWLER_LIVE_CASES.filter((liveCase) => liveCase.enabledByDefault);

  for (const liveCase of enabledCases) {
    const caseStartedAt = Date.now();
    try {
      const summary = await runCrawlerTesterJourney({
        page: input.page,
        target: input.target,
        liveCase,
      });
      results.push(passedCrawlerLiveCase(liveCase, Date.now() - caseStartedAt, summary));
    } catch (error) {
      results.push(failedCrawlerLiveCase(liveCase, Date.now() - caseStartedAt, error));
      const screenshotPath = input.testInfo.outputPath(`${input.target}-${liveCase.id}.png`);
      try {
        await input.page.screenshot({ path: screenshotPath, fullPage: true });
        await input.testInfo.attach(`${input.target}-${liveCase.id}`, {
          path: screenshotPath,
          contentType: "image/png",
        });
      } catch {
        // A closed browser/application is already represented by the classified case failure.
      }
    }
  }

  const report = buildCrawlerLiveReport({
    catalogVersion: CRAWLER_LIVE_CATALOG_VERSION,
    target: input.target,
    appVersion: process.env.MDCZ_APP_VERSION ?? "unknown",
    commit: process.env.GITHUB_SHA ?? process.env.MDCZ_GIT_COMMIT,
    startedAt,
    finishedAt: new Date(),
    cases: results,
  });
  const reportPath = input.testInfo.outputPath(`${input.target}-crawler-live-report.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await input.testInfo.attach(`${input.target}-crawler-live-report`, {
    path: reportPath,
    contentType: "application/json",
  });

  const failures = results.filter((result) => result.status === "failed");
  expect(failures, JSON.stringify(report, null, 2)).toEqual([]);
};

import { writeFile } from "node:fs/promises";
import type { TestInfo } from "@playwright/test";
import { LIVE_CATALOG_VERSION, type LiveCase, resolveWorkbenchLiveCase } from "../../live/catalog";
import {
  buildLiveReport,
  failedLiveCase,
  type LiveCaseResult,
  type LiveTarget,
  passedLiveCase,
} from "../../live/report";

export type WorkbenchLivePhase = "workbench-scrape" | "workbench-refresh";

export type WorkbenchLiveReportTarget = Extract<LiveTarget, "web" | "desktop">;

export interface ReportedWorkbenchFixture {
  cleanup: () => Promise<void>;
}

export interface ReportedWorkbenchJourneyInput<TFixture extends ReportedWorkbenchFixture> {
  testInfo: TestInfo;
  target: WorkbenchLiveReportTarget;
  phase: WorkbenchLivePhase;
  reportBaseName: string;
  liveCase?: LiveCase;
  createFixture: (liveCase: LiveCase) => TFixture;
  run: (input: { liveCase: LiveCase; fixture: TFixture }) => Promise<string>;
  afterSuccess?: () => void | Promise<void>;
  onFailure?: (error: unknown) => void | Promise<void>;
}

const writeAndAttachReport = async (input: {
  testInfo: TestInfo;
  reportBaseName: string;
  target: WorkbenchLiveReportTarget;
  startedAt: Date;
  cases: LiveCaseResult[];
}): Promise<void> => {
  const report = buildLiveReport({
    catalogVersion: LIVE_CATALOG_VERSION,
    layer: "e2e",
    target: input.target,
    appVersion: process.env.MDCZ_APP_VERSION ?? "unknown",
    commit: process.env.GITHUB_SHA ?? process.env.MDCZ_GIT_COMMIT,
    startedAt: input.startedAt,
    finishedAt: new Date(),
    cases: input.cases,
  });
  const reportPath = input.testInfo.outputPath(`${input.reportBaseName}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await input.testInfo.attach(input.reportBaseName, {
    path: reportPath,
    contentType: "application/json",
  });
};

/**
 * Shared report/exception/cleanup shell for Web and Desktop workbench live journeys.
 * Target-specific session, launch, page-error, and main-log hooks stay in the caller.
 */
export const runReportedWorkbenchJourney = async <TFixture extends ReportedWorkbenchFixture>(
  input: ReportedWorkbenchJourneyInput<TFixture>,
): Promise<void> => {
  const liveCase = input.liveCase ?? resolveWorkbenchLiveCase();
  const fixture = input.createFixture(liveCase);
  const startedAt = new Date();
  const caseStartedAt = Date.now();

  try {
    const summary = await input.run({ liveCase, fixture });
    await input.afterSuccess?.();
    await writeAndAttachReport({
      testInfo: input.testInfo,
      reportBaseName: input.reportBaseName,
      target: input.target,
      startedAt,
      cases: [
        passedLiveCase({
          liveCase,
          layer: "e2e",
          target: input.target,
          phase: input.phase,
          durationMs: Date.now() - caseStartedAt,
          summary,
        }),
      ],
    });
  } catch (error) {
    await writeAndAttachReport({
      testInfo: input.testInfo,
      reportBaseName: input.reportBaseName,
      target: input.target,
      startedAt,
      cases: [
        failedLiveCase({
          liveCase,
          layer: "e2e",
          target: input.target,
          phase: input.phase,
          durationMs: Date.now() - caseStartedAt,
          error,
        }),
      ],
    });
    await input.onFailure?.(error);
    throw error;
  } finally {
    await fixture.cleanup();
  }
};

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, describe, it } from "vitest";
import { LIVE_CASES, LIVE_CATALOG_VERSION } from "./catalog";
import { assertLiveRequiredFields } from "./fields";
import { createProductionCrawlerProvider } from "./provider-composition";
import { buildLiveReport, failedLiveCase, type LiveCaseResult, passedLiveCase } from "./report";

const CASE_TIMEOUT_MS = 90_000;
const REPORT_DIR = resolve(process.cwd(), "test-results", "live");
const REPORT_PATH = resolve(REPORT_DIR, "provider-integration-live-report.json");
const LAYER = "integration" as const;
const TARGET = "provider" as const;
const PHASE = "provider.crawl";

const enabledCases = LIVE_CASES.filter((liveCase) => liveCase.enabledByDefault);
const results: LiveCaseResult[] = [];
const startedAt = new Date();
const provider = createProductionCrawlerProvider();

describe("provider integration/live", () => {
  it.each(enabledCases)(
    "$id ($site / $number)",
    async (liveCase) => {
      const caseStartedAt = Date.now();
      try {
        const response = await provider.crawl({
          number: liveCase.number,
          site: liveCase.site,
          options: { timeoutMs: 30_000 },
        });

        if (!response.result.success) {
          const reason = response.result.failureReason ? ` (${response.result.failureReason})` : "";
          throw new Error(`${response.result.error}${reason}`);
        }

        const summary = assertLiveRequiredFields(response.result.data, liveCase.requiredFields);
        results.push(
          passedLiveCase({
            liveCase,
            layer: LAYER,
            target: TARGET,
            phase: PHASE,
            durationMs: Date.now() - caseStartedAt,
            summary,
          }),
        );
      } catch (error) {
        results.push(
          failedLiveCase({
            liveCase,
            layer: LAYER,
            target: TARGET,
            phase: PHASE,
            durationMs: Date.now() - caseStartedAt,
            error,
          }),
        );
        throw error;
      }
    },
    CASE_TIMEOUT_MS,
  );

  afterAll(async () => {
    try {
      const report = buildLiveReport({
        catalogVersion: LIVE_CATALOG_VERSION,
        layer: LAYER,
        target: TARGET,
        appVersion: process.env.MDCZ_APP_VERSION ?? "0.10.0",
        commit: process.env.GITHUB_SHA ?? process.env.MDCZ_GIT_COMMIT,
        startedAt,
        finishedAt: new Date(),
        cases: results,
      });
      await mkdir(REPORT_DIR, { recursive: true });
      await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    } finally {
      await provider.shutdown();
    }
  });
});

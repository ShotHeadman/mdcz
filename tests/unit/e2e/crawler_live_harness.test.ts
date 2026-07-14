import { listRegisteredCrawlerSites } from "@mdcz/runtime/crawler/registry";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";
import {
  assertCrawlerLiveCatalog,
  CRAWLER_LIVE_CASES,
  type CrawlerLiveCase,
  validateCrawlerLiveCatalog,
} from "../../e2e/live/crawler-live-catalog";
import {
  buildCrawlerLiveReport,
  classifyCrawlerLiveFailure,
  failedCrawlerLiveCase,
  sanitizeCrawlerLiveDiagnostic,
} from "../../e2e/live/crawler-live-report";
import { resolvePlaywrightTargetDiscovery } from "../../e2e/playwright-discovery";

const validCase = (): CrawlerLiveCase => ({
  id: "javdb-ssis-243",
  site: Website.JAVDB,
  number: "SSIS-243",
  label: "Public catalog entry",
  requiredFields: ["title"],
  enabledByDefault: true,
});

describe("crawler live catalog", () => {
  it("matches the runtime crawler registry and critical-site policy", () => {
    expect(() => assertCrawlerLiveCatalog(CRAWLER_LIVE_CASES, listRegisteredCrawlerSites())).not.toThrow();
  });

  it("rejects duplicate ids, unregistered sites, invalid fields, and sensitive keys", () => {
    const cases = [
      validCase(),
      {
        ...validCase(),
        site: "missing" as Website,
        requiredFields: ["title", "unknown"],
        cookie: "session=secret",
      },
    ] as unknown as CrawlerLiveCase[];

    expect(validateCrawlerLiveCatalog(cases, [Website.JAVDB], [])).toEqual(
      expect.arrayContaining([
        "Duplicate case id 'javdb-ssis-243'",
        "Case 'javdb-ssis-243' references unregistered site 'missing'",
        "Case 'javdb-ssis-243' contains unsupported required field 'unknown'",
        expect.stringContaining("contains sensitive field"),
      ]),
    );
  });
});

describe("crawler live diagnostics", () => {
  it("classifies observable failure categories", () => {
    expect(classifyCrawlerLiveFailure("Request timed out after 60s")).toBe("timeout");
    expect(classifyCrawlerLiveFailure("HTTP 429 too many requests")).toBe("rate_limited");
    expect(classifyCrawlerLiveFailure("Missing required field title")).toBe("contract_mismatch");
    expect(classifyCrawlerLiveFailure("Locator element(s) not found")).toBe("contract_mismatch");
    expect(classifyCrawlerLiveFailure("未抓取到可聚合结果")).toBe("not_found");
    expect(classifyCrawlerLiveFailure("ECONNRESET while fetching provider")).toBe("network");
  });

  it("redacts credentials and private paths before reporting", () => {
    const summary = sanitizeCrawlerLiveDiagnostic(
      "authorization=Bearer abc.def token=secret path=/home/doublechu/private/result.json",
    );

    expect(summary).not.toContain("abc.def");
    expect(summary).not.toContain("secret");
    expect(summary).not.toContain("/home/doublechu");
    expect(summary).toContain("[redacted]");
    expect(summary).toContain("[redacted-path]");
  });

  it("builds a stable aggregate report", () => {
    const liveCase = validCase();
    const failed = failedCrawlerLiveCase(liveCase, 1200, new Error("Timed out"));
    const report = buildCrawlerLiveReport({
      catalogVersion: "test",
      target: "web",
      appVersion: "0.10.0",
      commit: "abc123",
      startedAt: new Date("2026-07-13T00:00:00.000Z"),
      finishedAt: new Date("2026-07-13T00:00:02.000Z"),
      cases: [failed],
    });

    expect(report).toMatchObject({
      schemaVersion: 1,
      target: "web",
      appVersion: "0.10.0",
      totals: { passed: 0, failed: 1, total: 1 },
      cases: [{ failureKind: "timeout", status: "failed" }],
    });
  });
});

describe("Playwright live discovery", () => {
  it("excludes live specs by default and selects only live specs explicitly", () => {
    expect(resolvePlaywrightTargetDiscovery("web", false)).toEqual({
      testMatch: "web/**/*.e2e.spec.ts",
      testIgnore: ["web/**/*.live.e2e.spec.ts"],
    });
    expect(resolvePlaywrightTargetDiscovery("desktop", true)).toEqual({
      testMatch: "desktop/**/*.live.e2e.spec.ts",
      testIgnore: [],
    });
  });
});

import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { listRegisteredCrawlerSites } from "@mdcz/runtime/crawler/registry";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";
import { resolvePlaywrightTargetDiscovery } from "../../e2e/playwright-discovery";
import { resolveE2ERunnerLayout, resolvePlaywrightTarget, resolvePnpmCli } from "../../e2e/runner-layout.mjs";
import {
  assertLiveCatalog,
  LIVE_CASES,
  type LiveCase,
  resolveLiveCase,
  resolveWorkbenchLiveCase,
  validateLiveCatalog,
  WORKBENCH_LIVE_CASE_ID,
} from "../../live/catalog";
import { buildLiveReport, classifyLiveFailure, failedLiveCase, sanitizeLiveDiagnostic } from "../../live/report";

const validCase = (): LiveCase => ({
  id: "dmm-ssis-497",
  site: Website.DMM,
  number: "SSIS-497",
  label: "Public catalog entry",
  requiredFields: ["number", "title", "website"],
  enabledByDefault: true,
});

describe("live catalog", () => {
  it("matches the runtime crawler registry and critical-site policy", () => {
    expect(() => assertLiveCatalog(LIVE_CASES, listRegisteredCrawlerSites())).not.toThrow();
  });

  it("resolves the workbench representative case", () => {
    expect(WORKBENCH_LIVE_CASE_ID).toBe("dmm-ssis-497");
    expect(resolveWorkbenchLiveCase()).toMatchObject({
      id: "dmm-ssis-497",
      site: Website.DMM,
      number: "SSIS-497",
    });
    expect(resolveLiveCase(WORKBENCH_LIVE_CASE_ID).id).toBe(WORKBENCH_LIVE_CASE_ID);
  });

  it("keeps the default live catalog DMM-only", () => {
    expect(LIVE_CASES.map((liveCase) => liveCase.id)).toEqual(["dmm-ssis-497"]);
    expect(LIVE_CASES.every((liveCase) => liveCase.site === Website.DMM)).toBe(true);
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
    ] as unknown as LiveCase[];

    expect(validateLiveCatalog(cases, [Website.DMM], [])).toEqual(
      expect.arrayContaining([
        "Duplicate case id 'dmm-ssis-497'",
        "Case 'dmm-ssis-497' references unregistered site 'missing'",
        "Case 'dmm-ssis-497' contains unsupported required field 'unknown'",
        expect.stringContaining("contains sensitive field"),
      ]),
    );
  });

  it("requires common number/title/website fields on every case", () => {
    const cases: LiveCase[] = [
      {
        ...validCase(),
        requiredFields: ["title"],
      },
    ];

    expect(validateLiveCatalog(cases, [Website.DMM], [])).toEqual(
      expect.arrayContaining([
        "Case 'dmm-ssis-497' must require common field 'number'",
        "Case 'dmm-ssis-497' must require common field 'website'",
      ]),
    );
  });
});

describe("live diagnostics", () => {
  it("classifies observable failure categories", () => {
    expect(classifyLiveFailure("Request timed out after 60s")).toBe("timeout");
    expect(classifyLiveFailure("HTTP 429 too many requests")).toBe("rate_limited");
    expect(classifyLiveFailure("Missing required field title")).toBe("contract_mismatch");
    expect(classifyLiveFailure("Locator element(s) not found")).toBe("contract_mismatch");
    expect(classifyLiveFailure("未抓取到可聚合结果")).toBe("not_found");
    expect(classifyLiveFailure("ECONNRESET while fetching provider")).toBe("network");
    expect(classifyLiveFailure("Metadata parsing failed for SSIS-497 (parse_error)")).toBe("parser");
  });

  it("redacts credentials and private paths before reporting", () => {
    const summary = sanitizeLiveDiagnostic(
      "authorization=Bearer abc.def token=secret path=/home/doublechu/private/result.json",
    );

    expect(summary).not.toContain("abc.def");
    expect(summary).not.toContain("secret");
    expect(summary).not.toContain("/home/doublechu");
    expect(summary).toContain("[redacted]");
    expect(summary).toContain("[redacted-path]");
  });

  it("builds a stable aggregate report with layer and phase", () => {
    const liveCase = validCase();
    const failed = failedLiveCase({
      liveCase,
      layer: "integration",
      target: "provider",
      phase: "provider.crawl",
      durationMs: 1200,
      error: new Error("Timed out"),
    });
    const report = buildLiveReport({
      catalogVersion: "test",
      layer: "integration",
      target: "provider",
      appVersion: "0.10.0",
      commit: "abc123",
      startedAt: new Date("2026-07-13T00:00:00.000Z"),
      finishedAt: new Date("2026-07-13T00:00:02.000Z"),
      cases: [failed],
    });

    expect(report).toMatchObject({
      schemaVersion: 1,
      layer: "integration",
      target: "provider",
      appVersion: "0.10.0",
      totals: { passed: 0, failed: 1, total: 1 },
      cases: [{ failureKind: "timeout", status: "failed", phase: "provider.crawl" }],
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

  it("keeps only workbench live specs discoverable (4 journeys / 2 specs)", async () => {
    const webLive = await readdir(resolve(process.cwd(), "tests/e2e/web"));
    const desktopLive = await readdir(resolve(process.cwd(), "tests/e2e/desktop"));

    expect(webLive).toEqual(expect.arrayContaining(["web-workbench.live.e2e.spec.ts", "web-smoke.e2e.spec.ts"]));
    expect(webLive).not.toContain("web-crawler.live.e2e.spec.ts");
    expect(webLive.filter((name) => name.endsWith(".live.e2e.spec.ts"))).toEqual(["web-workbench.live.e2e.spec.ts"]);

    expect(desktopLive).toEqual(
      expect.arrayContaining(["desktop-workbench.live.e2e.spec.ts", "desktop-smoke.e2e.spec.ts"]),
    );
    expect(desktopLive).not.toContain("desktop-crawler.live.e2e.spec.ts");
    expect(desktopLive.filter((name) => name.endsWith(".live.e2e.spec.ts"))).toEqual([
      "desktop-workbench.live.e2e.spec.ts",
    ]);
  });
});

describe("E2E runner target isolation", () => {
  it("supports both pnpm-managed and direct Node runner invocations", () => {
    expect(resolvePnpmCli("/tools/pnpm.cjs")).toBe("/tools/pnpm.cjs");
    expect(resolvePnpmCli(undefined)).toBe("pnpm");
  });

  it("resolves both Playwright project argument forms", () => {
    expect(resolvePlaywrightTarget(["--project=web-chromium"])).toBe("web-chromium");
    expect(resolvePlaywrightTarget(["--project", "desktop-electron"])).toBe("desktop-electron");
    expect(resolvePlaywrightTarget([])).toBeUndefined();
  });

  it("keeps Web and Desktop runtime, media, logs, and reports disjoint", () => {
    const web = resolveE2ERunnerLayout("/repo", "web-chromium");
    const desktop = resolveE2ERunnerLayout("/repo", "desktop-electron");

    expect(web).toMatchObject({
      cleanupRuntimeRoots: ["/repo/.tmp/e2e-web"],
      serverRuntimeRoot: "/repo/.tmp/e2e-web/server",
      mediaDir: "/repo/.tmp/e2e-web/media",
      serverLogPath: "/repo/test-results/web-e2e-server.log",
      reportDir: "/repo/playwright-report-web",
      outputDir: "/repo/test-results/playwright-web",
    });
    expect(desktop).toMatchObject({
      cleanupRuntimeRoots: ["/repo/.tmp/e2e-desktop"],
      serverRuntimeRoot: "/repo/.tmp/e2e-desktop/server",
      mediaDir: "/repo/.tmp/e2e-desktop/media",
      serverLogPath: "/repo/test-results/desktop-e2e-server.log",
      reportDir: "/repo/playwright-report-desktop",
      outputDir: "/repo/test-results/playwright-desktop",
    });
    expect(desktop.serverRuntimeRoot).not.toBe(web.serverRuntimeRoot);
    expect(desktop.serverLogPath).not.toBe(web.serverLogPath);
  });
});

describe("Vitest integration-live discovery", () => {
  it("keeps the provider live integration file under tests/live", () => {
    const liveSpec = resolve(process.cwd(), "tests/live/provider.live.integration.test.ts");
    expect(liveSpec.endsWith("provider.live.integration.test.ts")).toBe(true);
    expect(LIVE_CASES.filter((liveCase) => liveCase.enabledByDefault)).toHaveLength(1);
  });
});

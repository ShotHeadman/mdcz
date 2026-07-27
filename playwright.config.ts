import { defineConfig, devices } from "@playwright/test";
import { resolvePlaywrightTargetDiscovery } from "./tests/e2e/playwright-discovery";

const baseURL = process.env.MDCZ_E2E_BASE_URL ?? "http://127.0.0.1:3838";
const browserExecutablePath = process.env.MDCZ_BROWSER_EXECUTABLE?.trim() || undefined;
const liveMode = process.env.MDCZ_E2E_LIVE === "1";
const outputDir = process.env.MDCZ_E2E_OUTPUT_DIR?.trim() || "test-results/playwright";
const reportDir = process.env.MDCZ_E2E_REPORT_DIR?.trim() || "playwright-report";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: liveMode ? 15 * 60_000 : 30_000,
  expect: {
    timeout: liveMode ? 60_000 : 8_000,
  },
  outputDir,
  reporter: process.env.CI
    ? [
        ["line"],
        ["junit", { outputFile: "test-results/product-e2e-junit.xml" }],
        ["html", { outputFolder: reportDir, open: "never" }],
      ]
    : [["line"], ["html", { outputFolder: reportDir, open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: browserExecutablePath ? "off" : "retain-on-failure",
  },
  projects: [
    {
      name: "web-chromium",
      ...resolvePlaywrightTargetDiscovery("web", liveMode),
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: browserExecutablePath ? { executablePath: browserExecutablePath } : undefined,
      },
    },
    {
      name: "desktop-electron",
      ...resolvePlaywrightTargetDiscovery("desktop", liveMode),
    },
  ],
});

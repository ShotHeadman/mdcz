import { defineConfig, devices } from "@playwright/test";
import { resolvePlaywrightTargetDiscovery } from "./tests/e2e/playwright-discovery";

const baseURL = process.env.MDCZ_E2E_BASE_URL ?? "http://127.0.0.1:3838";
const browserExecutablePath = process.env.MDCZ_BROWSER_EXECUTABLE?.trim() || undefined;
const liveMode = process.env.MDCZ_E2E_LIVE === "1";

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
  outputDir: "test-results/playwright",
  reporter: process.env.CI
    ? [
        ["line"],
        ["junit", { outputFile: "test-results/product-e2e-junit.xml" }],
        ["html", { outputFolder: "playwright-report", open: "never" }],
      ]
    : [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]],
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

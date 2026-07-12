import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.MDCZ_E2E_BASE_URL ?? "http://127.0.0.1:3838";
const browserExecutablePath = process.env.MDCZ_E2E_BROWSER_EXECUTABLE?.trim() || undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: {
    timeout: 8_000,
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
      testMatch: "web/**/*.e2e.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: browserExecutablePath ? { executablePath: browserExecutablePath } : undefined,
      },
    },
    {
      name: "desktop-electron",
      testMatch: "desktop/**/*.e2e.spec.ts",
    },
  ],
});

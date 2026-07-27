import { expect, type Page, test } from "@playwright/test";
import { createWorkbenchMediaFixture, createWorkbenchRefreshMediaFixture } from "../../live/workbench-fixture";
import { runReportedWorkbenchJourney } from "../live/reported-workbench-journey";
import { runWorkbenchRefreshJourney, WORKBENCH_REFRESH_JOURNEY_TIMEOUT_MS } from "../live/workbench-refresh-journey";
import { runWorkbenchScrapeJourney, WORKBENCH_SCRAPE_JOURNEY_TIMEOUT_MS } from "../live/workbench-scrape-journey";

const adminPassword = process.env.MDCZ_E2E_ADMIN_PASSWORD ?? "mdcz-e2e-admin-password";
const mediaDir = process.env.MDCZ_E2E_MEDIA_DIR;

if (!mediaDir) {
  throw new Error(
    "MDCZ_E2E_MEDIA_DIR is required. Run Web live E2E through pnpm test:live or node tests/e2e/web/run.mjs --live --project=web-chromium.",
  );
}

const readWebSessionState = async (page: Page): Promise<"setup" | "login" | "ready" | "loading"> => {
  if (/\/setup$/u.test(page.url())) return "setup";
  if (await page.getByRole("heading", { name: "管理员登录" }).isVisible()) return "login";
  if (await page.getByRole("link", { name: "设置" }).isVisible()) return "ready";
  return "loading";
};

const ensureWebSession = async (page: Page): Promise<void> => {
  await page.goto("/");
  await expect.poll(() => readWebSessionState(page)).not.toBe("loading");
  const state = await readWebSessionState(page);

  if (state === "setup") {
    await page.getByLabel("密码", { exact: true }).fill(adminPassword);
    await page.getByLabel("确认密码", { exact: true }).fill(adminPassword);
    await page.getByRole("button", { name: "继续" }).click();
    await page.getByLabel("媒体库显示名称").fill("Live E2E 媒体库");
    await page.getByLabel("库文件夹路径").fill(mediaDir);
    await page.getByRole("button", { name: "开始使用" }).click();
  } else if (state === "login") {
    await page.getByLabel("密码", { exact: true }).fill(adminPassword);
    await page.getByRole("button", { name: "登录" }).click();
  }

  await expect(page.getByRole("link", { name: "设置" })).toBeVisible();
};

test.describe
  .serial("Web workbench E2E/live", () => {
    test("scrapes the workbench representative case through the built Web product", async ({ page }, testInfo) => {
      test.setTimeout(WORKBENCH_SCRAPE_JOURNEY_TIMEOUT_MS);
      await runReportedWorkbenchJourney({
        testInfo,
        target: "web",
        phase: "workbench-scrape",
        reportBaseName: "web-workbench-scrape-live-report",
        createFixture: (liveCase) =>
          createWorkbenchMediaFixture({
            target: "web",
            journey: "scrape-live",
            number: liveCase.number,
          }),
        run: async ({ liveCase, fixture }) => {
          await ensureWebSession(page);
          return await runWorkbenchScrapeJourney({
            page,
            target: "web",
            liveCase,
            fixture,
            timeoutMs: WORKBENCH_SCRAPE_JOURNEY_TIMEOUT_MS,
          });
        },
      });
    });

    test("refreshes seeded NFO data through the built Web product", async ({ page }, testInfo) => {
      test.setTimeout(WORKBENCH_REFRESH_JOURNEY_TIMEOUT_MS);
      await runReportedWorkbenchJourney({
        testInfo,
        target: "web",
        phase: "workbench-refresh",
        reportBaseName: "web-workbench-refresh-live-report",
        createFixture: (liveCase) =>
          createWorkbenchRefreshMediaFixture({
            target: "web",
            number: liveCase.number,
          }),
        run: async ({ liveCase, fixture }) => {
          await ensureWebSession(page);
          return await runWorkbenchRefreshJourney({
            page,
            target: "web",
            liveCase,
            fixture,
            timeoutMs: WORKBENCH_REFRESH_JOURNEY_TIMEOUT_MS,
          });
        },
      });
    });
  });

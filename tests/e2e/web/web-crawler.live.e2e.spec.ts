import { expect, type Page, test } from "@playwright/test";
import { runCrawlerLiveCatalog } from "../live/run-crawler-live-catalog";

const adminPassword = process.env.MDCZ_E2E_ADMIN_PASSWORD ?? "mdcz-e2e-admin-password";
const mediaDir = process.env.MDCZ_E2E_MEDIA_DIR;

if (!mediaDir) {
  throw new Error("MDCZ_E2E_MEDIA_DIR is required. Run Web live E2E through pnpm test:e2e:live:web.");
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
  .serial("Web crawler external E2E/live", () => {
    test("runs the public crawler catalog through the built Web product", async ({ page }, testInfo) => {
      test.setTimeout(15 * 60_000);
      await ensureWebSession(page);
      await runCrawlerLiveCatalog({ page, target: "web", testInfo });
    });
  });

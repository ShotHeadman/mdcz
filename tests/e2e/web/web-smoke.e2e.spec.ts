import { expect, test } from "@playwright/test";

const adminPassword = "mdcz-e2e-admin-password";
const mediaDir = process.env.MDCZ_E2E_MEDIA_DIR;

if (!mediaDir) {
  throw new Error("MDCZ_E2E_MEDIA_DIR is required. Run Web E2E through pnpm test:e2e.");
}

test.describe
  .serial("Web product smoke", () => {
    test("starts the real Server and exposes its health endpoint", async ({ request }) => {
      const response = await request.get("/health");

      expect(response.ok()).toBe(true);
      await expect(response.json()).resolves.toMatchObject({ status: "ok" });
    });

    test("completes first-run setup and supports a fresh browser login", async ({ page }) => {
      await page.goto("/");
      await expect(page).toHaveURL(/\/setup$/u);
      await expect(page.getByText("设置管理员密码", { exact: true })).toBeVisible();

      await page.getByLabel("密码", { exact: true }).fill(adminPassword);
      await page.getByLabel("确认密码", { exact: true }).fill(adminPassword);
      await page.getByRole("button", { name: "继续" }).click();

      await expect(page.getByText("配置首个媒体库", { exact: true })).toBeVisible();
      await page.getByLabel("媒体库显示名称").fill("E2E 媒体库");
      await page.getByLabel("库文件夹路径").fill(mediaDir);
      await page.getByRole("button", { name: "开始使用" }).click();

      await expect(page).toHaveURL(/\/$/u);
      await expect(page.getByRole("link", { name: "设置" })).toBeVisible();

      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await expect(page.getByRole("heading", { name: "管理员登录" })).toBeVisible();
      await page.getByLabel("密码", { exact: true }).fill(adminPassword);
      await page.getByRole("button", { name: "登录" }).click();
      await expect(page.getByRole("link", { name: "设置" })).toBeVisible();
    });

    test("persists an auto-saved configuration value across refresh", async ({ page }) => {
      await page.goto("/settings");
      await expect(page.getByRole("heading", { name: "管理员登录" })).toBeVisible();
      await page.getByLabel("密码", { exact: true }).fill(adminPassword);
      await page.getByRole("button", { name: "登录" }).click();

      const search = page.getByRole("combobox");
      await search.fill("并发线程数");

      const threadCount = page.getByRole("spinbutton");
      await expect(threadCount).toBeVisible();
      const saveResponse = page.waitForResponse(
        (response) => response.url().includes("/trpc/config.update") && response.ok(),
      );
      await threadCount.fill("7");
      await threadCount.press("Enter");
      await saveResponse;

      await page.reload();
      await page.getByRole("combobox").fill("并发线程数");
      await expect(page.getByRole("spinbutton")).toHaveValue("7");
    });

    test("discovers the configured media directory through the built Web workbench", async ({ page }) => {
      await page.goto("/workbench");
      await expect(page.getByRole("heading", { name: "管理员登录" })).toBeVisible();
      await page.getByLabel("密码", { exact: true }).fill(adminPassword);
      const candidateResponse = page.waitForResponse(
        (response) => response.url().includes("/trpc/scans.candidates") && response.ok(),
      );
      await page.getByRole("button", { name: "登录" }).click();
      await candidateResponse;

      await expect(page).toHaveURL(/\/workbench$/u);
      await expect(page.getByText("MDCZ-001.mp4", { exact: true })).toBeVisible();
      await expect(page.getByText("incoming", { exact: true })).toBeVisible();
      await expect(page.getByText(/1 个文件/u).first()).toBeVisible();
    });
  });

import { expect, type Locator, type Page } from "@playwright/test";
import type { CrawlerLiveCase, CrawlerLiveRequiredField } from "./crawler-live-catalog";
import type { CrawlerLiveTarget } from "./crawler-live-report";

const RUNNING_LABEL = "测试中...";

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const openCrawlerTester = async (page: Page, target: CrawlerLiveTarget): Promise<void> => {
  if (target === "web") {
    await page.goto("/tools");
  } else {
    await page.getByRole("link", { name: "概览", exact: true }).click();
    await expect(page).toHaveURL(/overview/u);
    await page.getByRole("link", { name: "工具", exact: true }).click();
    await expect(page).toHaveURL(/tools/u);
  }

  const crawlerCard = page.getByRole("button", { name: /爬虫测试/u });
  await expect(crawlerCard).toBeVisible();
  await crawlerCard.click();
  await expect(page.getByPlaceholder("例如: ABP-001")).toBeVisible({ timeout: 10_000 });
};

const selectCrawlerSite = async (page: Page, site: string): Promise<void> => {
  const siteSelect = page.getByRole("combobox");
  await expect(siteSelect).toBeVisible();
  await siteSelect.click();
  const siteOption = page
    .locator('[data-slot="select-item"]')
    .filter({ hasText: new RegExp(`^${escapeRegExp(site)}`, "u") })
    .first();
  await expect(siteOption).toBeVisible({ timeout: 5_000 });
  await siteOption.click();
};

const waitForRunCompletion = async (runButton: Locator, timeoutMs: number): Promise<void> => {
  await expect(runButton).toHaveText(RUNNING_LABEL, { timeout: 10_000 });
  await expect(runButton).not.toHaveText(RUNNING_LABEL, { timeout: timeoutMs });
};

const assertValue = (field: CrawlerLiveRequiredField, value: unknown): string => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value) && value.some((item) => typeof item === "string" && item.trim())) {
    return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).join(", ");
  }
  throw new Error(`Required field '${field}' is missing from the visible crawler result`);
};

const readWebResult = async (page: Page, requiredFields: readonly CrawlerLiveRequiredField[]): Promise<string> => {
  const jsonResult = page.locator("pre").last();
  const visibleError = page.locator("p.text-destructive").last();
  await expect
    .poll(
      async () => {
        if (await jsonResult.isVisible()) return "json";
        if ((await visibleError.count()) > 0 && (await visibleError.textContent())?.trim()) return "error";
        return "pending";
      },
      { timeout: 5_000 },
    )
    .not.toBe("pending");

  if (!(await jsonResult.isVisible())) {
    const errorText = (await visibleError.count()) > 0 ? await visibleError.textContent() : null;
    throw new Error(errorText?.trim() || "Crawler live run failed");
  }

  const text = await jsonResult.textContent();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text ?? "");
  } catch (error) {
    throw new Error(
      `Unable to parse the visible Web crawler result: ${error instanceof Error ? error.message : error}`,
    );
  }
  if (parsed && typeof parsed === "object" && "ok" in parsed && (parsed as { ok?: unknown }).ok === false) {
    const message = "message" in parsed ? (parsed as { message?: unknown }).message : undefined;
    throw new Error(typeof message === "string" && message.trim() ? message : "Crawler live run failed");
  }

  const data =
    parsed && typeof parsed === "object" && "data" in parsed ? (parsed as { data?: unknown }).data : undefined;
  if (!data || typeof data !== "object") {
    throw new Error("Visible Web crawler result does not contain a data object");
  }

  const observed = requiredFields.map(
    (field) => `${field}=${assertValue(field, (data as Record<string, unknown>)[field])}`,
  );
  return observed.join("; ");
};

const readDesktopField = async (page: Page, field: CrawlerLiveRequiredField): Promise<string> => {
  const visibleLabels: Partial<Record<CrawlerLiveRequiredField, string>> = {
    title: "标题:",
    actors: "演员:",
  };
  const label = visibleLabels[field];
  if (!label) {
    throw new Error(`Required field '${field}' is not exposed by the existing Desktop crawler tester UI`);
  }
  const row = page.getByText(label, { exact: true }).locator("..");
  await expect(row).toBeVisible();
  const rowText = await row.innerText();
  return assertValue(field, rowText.replace(label, "").trim());
};

const readDesktopResult = async (page: Page, requiredFields: readonly CrawlerLiveRequiredField[]): Promise<string> => {
  await expect
    .poll(
      async () => {
        const bodyText = await page.locator("body").innerText();
        if (bodyText.includes("测试成功")) return "success";
        if (/测试失败|爬虫测试失败|未获取到数据/u.test(bodyText)) return "failure";
        return "pending";
      },
      { timeout: 10_000 },
    )
    .not.toBe("pending");

  if (!(await page.getByText("测试成功", { exact: true }).isVisible())) {
    const errorDetail = page.locator("p.text-destructive").last();
    if ((await errorDetail.count()) > 0) {
      const errorText = await errorDetail.textContent();
      if (errorText?.trim()) {
        throw new Error(errorText.trim());
      }
    }
    const bodyText = await page.locator("body").innerText();
    throw new Error(
      bodyText.match(/测试失败[^\n]*|爬虫测试失败[^\n]*|未获取到数据[^\n]*/u)?.[0] ?? "Crawler live run failed",
    );
  }

  const observed: string[] = [];
  for (const field of requiredFields) {
    observed.push(`${field}=${await readDesktopField(page, field)}`);
  }
  return observed.join("; ");
};

export const runCrawlerTesterJourney = async (input: {
  page: Page;
  target: CrawlerLiveTarget;
  liveCase: CrawlerLiveCase;
  timeoutMs?: number;
}): Promise<string> => {
  const timeoutMs = input.timeoutMs ?? 90_000;
  await openCrawlerTester(input.page, input.target);
  await selectCrawlerSite(input.page, input.liveCase.site);

  const numberInput = input.page.getByPlaceholder("例如: ABP-001");
  await numberInput.fill(input.liveCase.number);
  const runButton = input.page.getByRole("button", { name: /^(?:开始测试|运行爬虫测试|测试中\.\.\.)$/u });
  await expect(runButton).toBeEnabled();
  await runButton.click();
  await waitForRunCompletion(runButton, timeoutMs);

  return input.target === "web"
    ? await readWebResult(input.page, input.liveCase.requiredFields)
    : await readDesktopResult(input.page, input.liveCase.requiredFields);
};

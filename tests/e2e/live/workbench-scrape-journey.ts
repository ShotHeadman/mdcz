import { expect, type Page } from "@playwright/test";
import type { LiveCase } from "../../live/catalog";
import {
  findWorkbenchArtifacts,
  type WorkbenchLiveTarget,
  type WorkbenchMediaFixture,
} from "../../live/workbench-fixture";

export const WORKBENCH_SCRAPE_JOURNEY_TIMEOUT_MS = 10 * 60_000;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const pathControlInput = (page: Page, label: string) =>
  page
    .locator("div.space-y-2")
    .filter({ hasText: new RegExp(`^${escapeRegExp(label)}`, "u") })
    .locator("input");

const fillPathControl = async (page: Page, label: string, value: string): Promise<void> => {
  const input = pathControlInput(page, label);
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.click();
  await input.fill(value);
  await expect(input).toHaveValue(value);
  await input.blur();
};

export const applyWorkbenchLiveScrapeConfig = async (input: {
  page: Page;
  target: WorkbenchLiveTarget;
  liveCase: LiveCase;
  fixture: WorkbenchMediaFixture;
}): Promise<void> => {
  const patch = {
    scrape: {
      sites: [input.liveCase.site],
    },
    translate: {
      enableTranslation: false,
    },
    download: {
      downloadSceneImages: false,
      downloadTrailer: false,
      generateNfo: true,
    },
    personSync: {
      personImageSources: [] as string[],
    },
    paths: {
      mediaPath: input.fixture.fixtureDir,
      successOutputFolder: input.fixture.outputDir,
    },
  };

  if (input.target === "web") {
    await input.page.evaluate(async (configPatch) => {
      const token = localStorage.getItem("mdcz-admin-token");
      if (!token) {
        throw new Error("Missing mdcz-admin-token after Web login");
      }
      const response = await fetch("/trpc/config.update", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(configPatch),
      });
      if (!response.ok) {
        throw new Error(`config.update failed: ${response.status} ${await response.text()}`);
      }
    }, patch);
    return;
  }

  await input.page.evaluate(async (configPatch) => {
    await window.api.invoke("config:save" as never, { config: configPatch });
  }, patch);
};

export const openWorkbench = async (page: Page, target: WorkbenchLiveTarget): Promise<void> => {
  if (target === "web") {
    await page.goto("/workbench");
  } else {
    await page.getByRole("link", { name: "工作台", exact: true }).click();
  }
  await expect(page).toHaveURL(/workbench/u);
  await expect(page.getByText("扫描目录", { exact: true })).toBeVisible({ timeout: 30_000 });
};

export const setWorkbenchScanAndTargetDirs = async (page: Page, fixture: WorkbenchMediaFixture): Promise<void> => {
  await fillPathControl(page, "扫描目录", fixture.fixtureDir);
  await fillPathControl(page, "输出目录", fixture.outputDir);
};

export const waitForWorkbenchCandidate = async (page: Page, fileName: string): Promise<void> => {
  await expect(page.getByText(fileName, { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/1 个文件/u).first()).toBeVisible({ timeout: 30_000 });
};

export const startWorkbenchScrape = async (page: Page): Promise<void> => {
  const startButton = page.getByRole("button", { name: "开始", exact: true });
  await expect(startButton).toBeEnabled({ timeout: 30_000 });
  await startButton.click();
};

export const waitForWorkbenchScrapeSuccess = async (input: {
  page: Page;
  number: string;
  timeoutMs?: number;
}): Promise<void> => {
  const timeoutMs = input.timeoutMs ?? WORKBENCH_SCRAPE_JOURNEY_TIMEOUT_MS;
  const numberPattern = new RegExp(escapeRegExp(input.number), "u");
  let lastBodyText = "";

  await expect
    .poll(
      async () => {
        lastBodyText = await input.page.locator("body").innerText();
        const successMatch = lastBodyText.match(/成功:\s*(\d+)/u);
        const failedMatch = lastBodyText.match(/失败:\s*(\d+)/u);
        const successCount = successMatch ? Number(successMatch[1]) : 0;
        const failedCount = failedMatch ? Number(failedMatch[1]) : 0;

        if (failedCount > 0 && successCount === 0) {
          return "failed";
        }
        if (successCount > 0 && numberPattern.test(lastBodyText)) {
          return "success";
        }
        return "pending";
      },
      { timeout: timeoutMs },
    )
    .not.toBe("pending");

  const successMatch = lastBodyText.match(/成功:\s*(\d+)/u);
  const failedMatch = lastBodyText.match(/失败:\s*(\d+)/u);
  const successCount = successMatch ? Number(successMatch[1]) : 0;
  const failedCount = failedMatch ? Number(failedMatch[1]) : 0;
  if (failedCount > 0 && successCount === 0) {
    const detailMatch = lastBodyText.match(
      /region restriction|访问受限|blocked|未获取到数据|No crawler returned metadata[^\n]*|Detail URL not found[^\n]*/iu,
    );
    const failureDetail =
      detailMatch?.[0] ??
      `Workbench scrape blocked or failed for ${input.number} (失败: ${failedCount}, 成功: ${successCount})`;
    throw new Error(failureDetail);
  }

  await expect(input.page.getByText(input.number, { exact: true }).first()).toBeVisible();
  await expect(input.page.getByText(/成功:\s*[1-9]\d*/u).first()).toBeVisible();
};

export const assertWorkbenchArtifacts = async (input: {
  fixture: WorkbenchMediaFixture;
  number: string;
}): Promise<string[]> => {
  await expect
    .poll(
      async () =>
        await findWorkbenchArtifacts([input.fixture.outputDir, input.fixture.fixtureDir], {
          extensions: [".nfo", ".jpg", ".jpeg", ".png", ".webp"],
        }),
      { timeout: 60_000 },
    )
    .not.toEqual([]);

  const resolved = await findWorkbenchArtifacts([input.fixture.outputDir, input.fixture.fixtureDir], {
    extensions: [".nfo", ".jpg", ".jpeg", ".png", ".webp"],
  });
  if (resolved.length === 0) {
    throw new Error(`No local NFO/image artifacts found for ${input.number}`);
  }
  return resolved;
};

export const runWorkbenchScrapeJourney = async (input: {
  page: Page;
  target: WorkbenchLiveTarget;
  liveCase: LiveCase;
  fixture: WorkbenchMediaFixture;
  timeoutMs?: number;
}): Promise<string> => {
  const timeoutMs = input.timeoutMs ?? WORKBENCH_SCRAPE_JOURNEY_TIMEOUT_MS;
  await input.fixture.prepare();
  await input.fixture.assertZeroByte();

  await applyWorkbenchLiveScrapeConfig({
    page: input.page,
    target: input.target,
    liveCase: input.liveCase,
    fixture: input.fixture,
  });

  await openWorkbench(input.page, input.target);
  await setWorkbenchScanAndTargetDirs(input.page, input.fixture);
  await waitForWorkbenchCandidate(input.page, input.fixture.fileName);
  await startWorkbenchScrape(input.page);
  await waitForWorkbenchScrapeSuccess({
    page: input.page,
    number: input.liveCase.number,
    timeoutMs,
  });

  const artifacts = await assertWorkbenchArtifacts({
    fixture: input.fixture,
    number: input.liveCase.number,
  });

  return `number=${input.liveCase.number}; site=${input.liveCase.site}; artifacts=${artifacts.length}`;
};

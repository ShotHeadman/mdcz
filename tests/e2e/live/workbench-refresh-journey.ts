import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import type { LiveCase } from "../../live/catalog";
import {
  findWorkbenchArtifacts,
  WORKBENCH_REFRESH_STALE_TITLE,
  type WorkbenchLiveTarget,
  type WorkbenchRefreshMediaFixture,
} from "../../live/workbench-fixture";
import {
  applyWorkbenchLiveScrapeConfig,
  setWorkbenchScanAndTargetDirs,
  WORKBENCH_SCRAPE_JOURNEY_TIMEOUT_MS,
  waitForWorkbenchCandidate,
} from "./workbench-scrape-journey";

export const WORKBENCH_REFRESH_JOURNEY_TIMEOUT_MS = WORKBENCH_SCRAPE_JOURNEY_TIMEOUT_MS;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

export const openWorkbenchMaintenanceMode = async (page: Page, target: WorkbenchLiveTarget): Promise<void> => {
  if (target === "web") {
    await page.goto("/workbench?intent=maintenance");
  } else {
    await page.getByRole("link", { name: "概览", exact: true }).click();
    await page
      .getByRole("heading", { name: "维护", exact: true })
      .locator("xpath=ancestor::section[1]")
      .getByRole("button", { name: "去工作台", exact: true })
      .click();
  }
  await expect(page).toHaveURL(/workbench/u);
  await expect(page.getByText("维护预设", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("扫描目录", { exact: true })).toBeVisible({ timeout: 30_000 });
};

export const selectWorkbenchMaintenancePreset = async (page: Page, label: string): Promise<void> => {
  const presetButton = page.getByRole("button", { name: new RegExp(escapeRegExp(label), "u") });
  await expect(presetButton).toBeVisible({ timeout: 30_000 });
  await presetButton.click();
  await expect(presetButton).toBeVisible();
};

export const startWorkbenchMaintenance = async (page: Page): Promise<void> => {
  const startButton = page.getByRole("button", { name: "开始", exact: true });
  await expect(startButton).toBeEnabled({ timeout: 30_000 });
  await startButton.click();
};

export const waitForWorkbenchRefreshPreview = async (input: {
  page: Page;
  number: string;
  staleTitle?: string;
  timeoutMs?: number;
}): Promise<void> => {
  const timeoutMs = input.timeoutMs ?? WORKBENCH_REFRESH_JOURNEY_TIMEOUT_MS;
  const staleTitle = input.staleTitle ?? WORKBENCH_REFRESH_STALE_TITLE;
  const numberPattern = new RegExp(escapeRegExp(input.number), "u");
  let lastBodyText = "";

  await expect
    .poll(
      async () => {
        lastBodyText = await input.page.locator("body").innerText();
        const hasStaleTitle = lastBodyText.includes(staleTitle);
        const hasNumber = numberPattern.test(lastBodyText);
        const hasDiffChrome =
          lastBodyText.includes("旧 (当前)") ||
          lastBodyText.includes("新 (预览)") ||
          lastBodyText.includes("数据对比") ||
          lastBodyText.includes("数据替换");
        if (hasStaleTitle && hasNumber && hasDiffChrome) {
          return "ready";
        }
        return "pending";
      },
      { timeout: timeoutMs },
    )
    .toBe("ready");

  if (!lastBodyText.includes(staleTitle)) {
    throw new Error(
      `Refresh preview degraded to first-fill: missing seeded old title '${staleTitle}' for ${input.number}`,
    );
  }

  await expect(input.page.getByText(staleTitle, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(input.page.getByText(input.number, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  const remoteTitleOption = input.page
    .getByRole("button", { name: /^新 \(预览\) (?!\(空\)$).+/u })
    .filter({ hasNotText: "图片来源" })
    .first();
  await expect(remoteTitleOption).toBeEnabled({ timeout: 30_000 });
  await remoteTitleOption.click();
};

export const applyWorkbenchRefreshPreview = async (page: Page): Promise<void> => {
  const replaceButton = page.getByRole("button", { name: "数据替换", exact: true });
  await expect(replaceButton).toBeEnabled({ timeout: 60_000 });
  await replaceButton.click();

  const confirmButton = page.getByRole("button", { name: /开始批量执行/u });
  await expect(confirmButton).toBeEnabled({ timeout: 30_000 });
  await confirmButton.click();
};

export const waitForWorkbenchRefreshSuccess = async (input: {
  fixture: WorkbenchRefreshMediaFixture;
  page: Page;
  number: string;
  timeoutMs?: number;
}): Promise<void> => {
  const timeoutMs = input.timeoutMs ?? WORKBENCH_REFRESH_JOURNEY_TIMEOUT_MS;
  const pauseButton = input.page.getByRole("button", { name: "暂停维护操作", exact: true });
  const resumeButton = input.page.getByRole("button", { name: "恢复维护操作", exact: true });
  const activeExecutionControls = pauseButton.or(resumeButton);

  // The filter bar always contains the words "成功" and "失败", while a fast
  // IPC execution may finish before Playwright observes its transient controls.
  // The rewritten NFO is the durable completion signal for both runtimes.
  await expect
    .poll(
      async () => {
        const content = await readFile(input.fixture.nfoPath, "utf8").catch(() => "");
        const rewritten =
          content.length > 0 &&
          content !== input.fixture.seedNfoContent &&
          content.includes(input.number) &&
          (content.includes("<dateadded>") || content.includes("<mdcz>"));
        return rewritten ? "rewritten" : "pending";
      },
      { timeout: timeoutMs },
    )
    .toBe("rewritten");
  await expect(activeExecutionControls).toBeHidden({ timeout: timeoutMs });

  await expect(input.page.getByText(input.number, { exact: true }).first()).toBeVisible();
};

export const assertWorkbenchRefreshArtifacts = async (input: {
  fixture: WorkbenchRefreshMediaFixture;
  number: string;
  seedNfoContent: string;
  staleTitle?: string;
}): Promise<string[]> => {
  const staleTitle = input.staleTitle ?? WORKBENCH_REFRESH_STALE_TITLE;
  const seedNfoContent = input.seedNfoContent;

  if (seedNfoContent.includes("<dateadded>") || seedNfoContent.includes("<mdcz>")) {
    throw new Error("Seed NFO unexpectedly contains production markers; cannot prove apply");
  }

  await expect
    .poll(
      async () =>
        await findWorkbenchArtifacts([input.fixture.outputDir, input.fixture.fixtureDir], {
          extensions: [".nfo", ".jpg", ".jpeg", ".png", ".webp"],
        }),
      { timeout: 60_000 },
    )
    .not.toEqual([]);

  const artifacts = await findWorkbenchArtifacts([input.fixture.outputDir, input.fixture.fixtureDir], {
    extensions: [".nfo", ".jpg", ".jpeg", ".png", ".webp"],
  });
  if (artifacts.length === 0) {
    throw new Error(`No local NFO/image artifacts found after refresh for ${input.number}`);
  }

  const nfoArtifacts = artifacts.filter((artifact) => artifact.toLowerCase().endsWith(".nfo"));
  if (nfoArtifacts.length === 0) {
    throw new Error(`No NFO artifacts found after refresh for ${input.number}`);
  }

  let foundUpdatedNfo = false;
  for (const nfoPath of nfoArtifacts) {
    const content = await readFile(nfoPath, "utf8");
    if (!content.includes(input.number)) {
      continue;
    }

    if (content === seedNfoContent) {
      throw new Error(`Refresh left seed-only NFO content in ${nfoPath}`);
    }

    // Seed NFO is hand-written without dateadded / mdcz and uses the stale title for
    // both title and originaltitle. Applied refresh must rewrite beyond that seed.
    const originalTitleMatch = content.match(/<originaltitle>([^<]*)<\/originaltitle>/u);
    const originalTitle = originalTitleMatch?.[1]?.trim() ?? "";
    const titleMatch = content.match(/<title>([^<]*)<\/title>/u);
    const title = titleMatch?.[1]?.trim() ?? "";
    const dateaddedMatch = content.match(/<dateadded>([^<]*)<\/dateadded>/u);
    const dateadded = dateaddedMatch?.[1]?.trim() ?? "";

    const titleRewritten =
      (originalTitle.length > 0 && originalTitle !== staleTitle) || (title.length > 0 && title !== staleTitle);
    const productionMarkersPresent = dateadded.length > 0 || content.includes("<mdcz>");

    if (!titleRewritten) {
      throw new Error(
        `Refresh NFO in ${nfoPath} kept stale titles (title='${title}', originaltitle='${originalTitle}')`,
      );
    }
    if (!productionMarkersPresent) {
      throw new Error(`Refresh NFO in ${nfoPath} lacks production markers (dateadded/mdcz) expected after apply`);
    }

    foundUpdatedNfo = true;
  }

  if (!foundUpdatedNfo) {
    throw new Error(`No updated NFO found after refresh for ${input.number}`);
  }

  return artifacts;
};

export const runWorkbenchRefreshJourney = async (input: {
  page: Page;
  target: WorkbenchLiveTarget;
  liveCase: LiveCase;
  fixture: WorkbenchRefreshMediaFixture;
  timeoutMs?: number;
}): Promise<string> => {
  const timeoutMs = input.timeoutMs ?? WORKBENCH_REFRESH_JOURNEY_TIMEOUT_MS;
  await input.fixture.prepare();
  await input.fixture.assertZeroByte();
  await input.fixture.assertStaleNfo();

  await applyWorkbenchLiveScrapeConfig({
    page: input.page,
    target: input.target,
    liveCase: input.liveCase,
    fixture: input.fixture,
  });

  await openWorkbenchMaintenanceMode(input.page, input.target);
  await selectWorkbenchMaintenancePreset(input.page, "刷新数据");
  await setWorkbenchScanAndTargetDirs(input.page, input.fixture);
  await waitForWorkbenchCandidate(input.page, input.fixture.fileName);
  await startWorkbenchMaintenance(input.page);
  await waitForWorkbenchRefreshPreview({
    page: input.page,
    number: input.liveCase.number,
    staleTitle: input.fixture.staleTitle,
    timeoutMs,
  });
  await applyWorkbenchRefreshPreview(input.page);
  await waitForWorkbenchRefreshSuccess({
    fixture: input.fixture,
    page: input.page,
    number: input.liveCase.number,
    timeoutMs,
  });

  const artifacts = await assertWorkbenchRefreshArtifacts({
    fixture: input.fixture,
    number: input.liveCase.number,
    seedNfoContent: input.fixture.seedNfoContent,
    staleTitle: input.fixture.staleTitle,
  });

  return `number=${input.liveCase.number}; site=${input.liveCase.site}; staleTitle=${input.fixture.staleTitle}; artifacts=${artifacts.length}`;
};

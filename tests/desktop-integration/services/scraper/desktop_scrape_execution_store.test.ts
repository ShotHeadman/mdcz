import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DesktopPersistenceService } from "@main/services/persistence";
import { DesktopScrapeExecutionStore } from "@main/services/scraper/DesktopScrapeExecutionStore";
import { createMediaRoot } from "@mdcz/media-store";
import type { ScrapeResult } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

const directories: string[] = [];
const persistenceServices: DesktopPersistenceService[] = [];

const createHarness = async () => {
  const directory = await mkdtemp(join(process.env.TEMP ?? process.cwd(), "mdcz-desktop-execution-"));
  directories.push(directory);
  const mediaRoot = join(directory, "media");
  await mkdir(mediaRoot, { recursive: true });
  const persistence = new DesktopPersistenceService(join(directory, "mdcz.sqlite"), null);
  persistenceServices.push(persistence);
  return {
    directory,
    mediaRoot,
    persistence,
    store: new DesktopScrapeExecutionStore(persistence, async () => mediaRoot),
  };
};

const successResult = (filePath: string, number = "ABP-001"): ScrapeResult => ({
  status: "success",
  fileId: number.toLowerCase(),
  fileInfo: {
    filePath,
    fileName: `${number}.mp4`,
    extension: ".mp4",
    number,
    isSubtitled: false,
  },
  crawlerData: {
    title: `${number} title`,
    number,
    actors: ["Actor A"],
    genres: [],
    scene_images: [],
  },
});

describe("DesktopScrapeExecutionStore", () => {
  afterEach(async () => {
    await Promise.all(persistenceServices.splice(0).map(async (service) => await service.close()));
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
    vi.restoreAllMocks();
  });

  it("persists only an immutable manifest before terminal item commits", async () => {
    const { mediaRoot, persistence, store } = await createHarness();
    const filePath = join(mediaRoot, "ABP-001.mp4");
    await writeFile(filePath, "video");

    const created = await store.createRun([filePath], "single", null);
    const state = await persistence.getState();

    await expect(state.repositories.scrapeRuns.getRun(created.manifest.id)).resolves.toEqual(created.manifest);
    await expect(state.repositories.scrapeRuns.listOutcomes(created.manifest.id)).resolves.toEqual([]);
    await expect(state.repositories.scrapeRuns.getSummary(created.manifest.id)).resolves.toBeNull();
    await expect(state.repositories.tasks.list()).resolves.toEqual([]);
  });

  it("commits success with library facts under the longest containing root and finalizes once", async () => {
    const { mediaRoot, persistence, store } = await createHarness();
    const inputPath = join(mediaRoot, "ABP-001.mp4");
    const outputRootPath = join(mediaRoot, "organized");
    const outputPath = join(outputRootPath, "ABP-001.mp4");
    await writeFile(inputPath, "source");
    await mkdir(outputRootPath, { recursive: true });
    await writeFile(outputPath, "organized-video");
    const outputRoot = createMediaRoot({
      id: "desktop-output",
      displayName: "Output",
      hostPath: outputRootPath,
    });
    const created = await store.createRun([inputPath], "single", outputRoot);

    const committed = await store.commitItem(created.manifest.id, created.items[0], successResult(outputPath));
    const summary = await store.finalizeRun(created.manifest.id, "completed");
    const state = await persistence.getState();
    const entries = await state.repositories.library.listEntries();

    expect(committed).toMatchObject({ status: "success", resultId: expect.any(String) });
    expect(await state.repositories.scrapeRuns.listLatestOutcomes(created.manifest.id)).toMatchObject([
      {
        id: committed.resultId,
        outcome: "success",
        outputRootId: "desktop-output",
        outputRelativePath: "ABP-001.mp4",
        attempt: 1,
      },
    ]);
    expect(entries).toMatchObject([
      {
        rootId: "desktop-output",
        rootRelativePath: "ABP-001.mp4",
        sourceRunId: created.manifest.id,
        sourceOutcomeId: committed.resultId,
        number: "ABP-001",
      },
    ]);
    expect(summary).toMatchObject({
      disposition: "completed",
      successCount: 1,
      totalBytes: Buffer.byteLength("organized-video"),
      outputRootId: "desktop-output",
      outputDirectory: outputRootPath,
    });
    await expect(store.finalizeRun(created.manifest.id, "completed")).rejects.toThrow();
  });

  it("records a coordinated failure when disk output exists but the success transaction fails", async () => {
    const { mediaRoot, persistence, store } = await createHarness();
    const filePath = join(mediaRoot, "ABP-001.mp4");
    await writeFile(filePath, "video");
    const created = await store.createRun([filePath], "single", null);
    const state = await persistence.getState();
    vi.spyOn(state.repositories.scrapeRuns, "commitSuccess").mockRejectedValueOnce(
      new Error("library constraint failed"),
    );

    const committed = await store.commitItem(created.manifest.id, created.items[0], successResult(filePath));

    expect(committed).toMatchObject({
      status: "failed",
      error: expect.stringContaining("文件操作已完成，但媒体库提交失败：library constraint failed"),
    });
    await expect(state.repositories.scrapeRuns.listLatestOutcomes(created.manifest.id)).resolves.toMatchObject([
      {
        id: committed.resultId,
        outcome: "failed",
        attempt: 1,
      },
    ]);
    await expect(state.repositories.library.listEntries()).resolves.toEqual([]);
  });
});

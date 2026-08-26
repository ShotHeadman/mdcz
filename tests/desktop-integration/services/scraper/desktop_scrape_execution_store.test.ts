import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DesktopPersistenceService } from "@main/services/persistence";
import { DesktopScrapeExecutionStore } from "@main/services/scraper/DesktopScrapeExecutionStore";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];

describe("DesktopScrapeExecutionStore", () => {
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("recovers pending SQLite execution state across store instances", async () => {
    const directory = await mkdtemp(join(process.env.TEMP ?? process.cwd(), "mdcz-desktop-execution-"));
    directories.push(directory);
    const mediaRoot = join(directory, "media");
    await writeFile(join(directory, "placeholder"), "ok");
    const filePath = join(mediaRoot, "ABP-001.mp4");
    await mkdir(mediaRoot, { recursive: true });
    await writeFile(filePath, "video");
    const persistencePath = join(directory, "mdcz.sqlite");

    const first = new DesktopPersistenceService(persistencePath, null);
    const store = new DesktopScrapeExecutionStore(first, async () => mediaRoot);
    const execution = await store.create([filePath]);
    expect(await store.pause(execution)).toBe(true);
    await expect(store.resume(execution)).resolves.toEqual(execution);
    await expect((await first.getState()).repositories.tasks.get(execution.taskId)).resolves.toMatchObject({
      status: "running",
      executionVersion: execution.executionVersion,
    });
    expect(await store.markProcessing(execution, filePath)).toBe(true);
    await first.close();

    const second = new DesktopPersistenceService(persistencePath, null);
    const recovered = new DesktopScrapeExecutionStore(second, async () => mediaRoot);
    await expect(recovered.getRecoverable()).resolves.toMatchObject({
      taskId: execution.taskId,
      pendingFiles: [filePath],
    });
    await second.close();
  });
});

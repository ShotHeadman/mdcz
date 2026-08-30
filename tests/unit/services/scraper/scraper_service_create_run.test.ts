import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfiguration } from "@main/services/config";
import { DesktopPersistenceService } from "@main/services/persistence";
import { SignalService } from "@main/services/SignalService";
import { ScraperService } from "@main/services/scraper/ScraperService";
import { createMediaRoot } from "@mdcz/media-store";
import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import { NetworkClient } from "@mdcz/runtime/network";
import { FileScraper } from "@mdcz/runtime/scrape";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockConfigManager } from "../../../helpers/scraper";

const directories: string[] = [];
const persistenceServices: DesktopPersistenceService[] = [];
const scraperServices: ScraperService[] = [];

const createHarness = async () => {
  const directory = await mkdtemp(join(tmpdir(), "mdcz-scraper-create-run-"));
  directories.push(directory);
  const persistence = new DesktopPersistenceService(join(directory, "mdcz.sqlite"), null);
  persistenceServices.push(persistence);
  const service = new ScraperService(
    new SignalService(null),
    new NetworkClient(),
    new CrawlerProvider({ fetchGateway: new FetchGateway(new NetworkClient()) }),
    undefined,
    undefined,
    undefined,
    undefined,
    persistence,
  );
  scraperServices.push(service);
  mockConfigManager({
    ...defaultConfiguration,
    paths: { ...defaultConfiguration.paths, mediaPath: join(directory, "library-a") },
  });
  vi.spyOn(FileScraper.prototype, "scrapeFile").mockResolvedValue({
    fileId: "ABC-001.mp4",
    rootId: "unused",
    relativePath: "ABC-001.mp4",
    fileName: "ABC-001.mp4",
    status: "failed",
    error: "test",
    assets: [],
  });
  return { directory, persistence, service };
};

describe("ScraperService ref-native start", () => {
  afterEach(async () => {
    await Promise.all(scraperServices.splice(0).map(async (service) => await service.shutdown({ timeoutMs: 1_000 })));
    await Promise.all(persistenceServices.splice(0).map(async (service) => await service.close()));
    await Promise.all(
      directories.splice(0).map(async (directory) => await rm(directory, { recursive: true, force: true })),
    );
    vi.restoreAllMocks();
  });

  it("derives the run root from selected refs, not from config.paths.mediaPath", async () => {
    const { directory, persistence, service } = await createHarness();
    const scanRootPath = join(directory, "scan-b");
    await mkdir(scanRootPath, { recursive: true });
    const state = await persistence.getState();
    const scanRoot = await state.repositories.mediaRoots.ensurePath(scanRootPath);
    const result = await service.start([{ rootId: scanRoot.id, relativePath: "ABC-001.mp4" }]);
    const run = await state.repositories.scrapeRuns.get(result.taskId);
    expect(run.rootId).toBe(scanRoot.id);
    expect(run.items).toEqual([expect.objectContaining({ rootId: scanRoot.id, relativePath: "ABC-001.mp4" })]);
  });

  it("rejects mixed-root refs", async () => {
    const { directory, persistence, service } = await createHarness();
    const state = await persistence.getState();
    const first = await state.repositories.mediaRoots.upsert(
      createMediaRoot({ id: "root-a", displayName: "A", hostPath: join(directory, "a") }),
    );
    const second = await state.repositories.mediaRoots.upsert(
      createMediaRoot({ id: "root-b", displayName: "B", hostPath: join(directory, "b") }),
    );
    await expect(
      service.start([
        { rootId: first.id, relativePath: "one.mp4" },
        { rootId: second.id, relativePath: "two.mp4" },
      ]),
    ).rejects.toMatchObject({
      code: "MIXED_ROOTS",
      message: "刮削任务只能包含同一个媒体目录下的文件",
    });
  });

  it("uses a caller-supplied outputRootId instead of the configured desktop output root", async () => {
    const { directory, persistence, service } = await createHarness();
    const scanRootPath = join(directory, "scan-b");
    const outputRootPath = join(directory, "output-c");
    await mkdir(scanRootPath, { recursive: true });
    await mkdir(outputRootPath, { recursive: true });
    const state = await persistence.getState();
    const scanRoot = await state.repositories.mediaRoots.ensurePath(scanRootPath);
    const outputRoot = await state.repositories.mediaRoots.ensurePath(outputRootPath);
    const result = await service.start([{ rootId: scanRoot.id, relativePath: "ABC-001.mp4" }], outputRoot.id);
    const run = await state.repositories.scrapeRuns.get(result.taskId);
    expect(run.requestedOutputRootId).toBe(outputRoot.id);
    expect(run.rootId).toBe(scanRoot.id);
  });

  it("rejects a native directory pick that contains multiple media files", async () => {
    const { directory, service } = await createHarness();
    const folder = join(directory, "picked");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "one.mp4"), "video");
    await writeFile(join(folder, "two.mp4"), "video");
    await expect(service.startFromNativePath(folder)).rejects.toMatchObject({ code: "MULTIPLE_FILES" });
  });
});

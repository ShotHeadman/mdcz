import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DesktopPersistenceService } from "@main/services/persistence";
import { DesktopScrapePublisher } from "@main/services/scraper/DesktopScrapePublisher";
import { createMediaRoot } from "@mdcz/media-store";
import type { ScrapeResult } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

const directories: string[] = [];
const persistenceServices: DesktopPersistenceService[] = [];

const successResult = (relativePath: string, number = "ABP-001"): ScrapeResult => ({
  status: "success",
  fileId: number.toLowerCase(),
  rootId: "desktop-input",
  relativePath,
  fileName: `${number}.mp4`,
  assets: [],
  crawlerData: {
    title: `${number} title`,
    number,
    actors: ["Actor A"],
    genres: [],
    scene_images: [],
  },
});

const createHarness = async () => {
  const directory = await mkdtemp(join(process.env.TEMP ?? process.cwd(), "mdcz-desktop-publisher-"));
  directories.push(directory);
  const mediaRoot = join(directory, "media");
  await mkdir(mediaRoot, { recursive: true });
  const persistence = new DesktopPersistenceService(join(directory, "mdcz.sqlite"), null);
  persistenceServices.push(persistence);
  return { mediaRoot, persistence, publisher: new DesktopScrapePublisher(persistence) };
};

describe("DesktopScrapePublisher", () => {
  afterEach(async () => {
    await Promise.all(persistenceServices.splice(0).map(async (service) => await service.close()));
    await Promise.all(
      directories.splice(0).map(async (directory) => await rm(directory, { recursive: true, force: true })),
    );
    vi.restoreAllMocks();
  });

  it("publishes a successful item through the shared publication boundary", async () => {
    const { mediaRoot, persistence, publisher } = await createHarness();
    const inputPath = join(mediaRoot, "ABP-001.mp4");
    const outputRootPath = join(mediaRoot, "organized");
    await writeFile(inputPath, "source");
    await mkdir(outputRootPath, { recursive: true });
    const inputRoot = createMediaRoot({ id: "desktop-input", displayName: "Input", hostPath: mediaRoot });
    const outputRoot = createMediaRoot({ id: "desktop-output", displayName: "Output", hostPath: outputRootPath });
    const state = await persistence.getState();
    await state.repositories.mediaRoots.upsert(inputRoot);
    await state.repositories.mediaRoots.upsert(outputRoot);
    const manifest = await state.repositories.scrapeRuns.create({
      rootId: inputRoot.id,
      outputRootId: outputRoot.id,
      executionMode: "single",
      items: [{ ordinal: 0, rootId: inputRoot.id, relativePath: "ABP-001.mp4" }],
    });
    const result = {
      ...successResult("ABP-001.mp4"),
      publicationPlan: {
        operationId: `${manifest.id}:${manifest.items[0].id}`,
        operationType: "scrape" as const,
        video: {
          source: { rootId: inputRoot.id, relativePath: "ABP-001.mp4" },
          target: { rootId: outputRoot.id, relativePath: "ABP-001.mp4" },
          size: Buffer.byteLength("source"),
        },
        artifacts: [],
        assets: [],
        obsolete: [],
      },
    };

    const committed = await publisher.commitItem(
      manifest.id,
      {
        id: manifest.items[0].id,
        rootId: inputRoot.id,
        relativePath: "ABP-001.mp4",
        sourcePath: inputPath,
      },
      result,
    );

    expect(committed).toMatchObject({ status: "success", resultId: expect.any(String) });
    expect(await state.repositories.library.listEntries()).toMatchObject([
      { rootId: outputRoot.id, rootRelativePath: "ABP-001.mp4", sourceRunId: manifest.id },
    ]);
  });

  it("records a coordinated failure when the success transaction fails", async () => {
    const { mediaRoot, persistence, publisher } = await createHarness();
    const filePath = join(mediaRoot, "ABP-001.mp4");
    await writeFile(filePath, "video");
    const root = createMediaRoot({ id: "desktop-input", displayName: "Input", hostPath: mediaRoot });
    const state = await persistence.getState();
    await state.repositories.mediaRoots.upsert(root);
    const manifest = await state.repositories.scrapeRuns.create({
      rootId: root.id,
      executionMode: "single",
      items: [{ ordinal: 0, rootId: root.id, relativePath: "ABP-001.mp4" }],
    });
    vi.spyOn(state.repositories.scrapeRuns, "commitSuccessOutcome").mockImplementationOnce(() => {
      throw new Error("library constraint failed");
    });
    const result = {
      ...successResult("ABP-001.mp4"),
      publicationPlan: {
        operationId: `${manifest.id}:${manifest.items[0].id}`,
        operationType: "scrape" as const,
        video: {
          source: { rootId: root.id, relativePath: "ABP-001.mp4" },
          target: { rootId: root.id, relativePath: "ABP-001.mp4" },
          size: Buffer.byteLength("video"),
        },
        artifacts: [],
        assets: [],
        obsolete: [],
      },
    };

    const committed = await publisher.commitItem(
      manifest.id,
      {
        id: manifest.items[0].id,
        rootId: root.id,
        relativePath: "ABP-001.mp4",
        sourcePath: filePath,
      },
      result,
    );

    expect(committed).toMatchObject({
      status: "failed",
      error: expect.stringContaining("library constraint failed"),
    });
  });
});

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesktopPersistenceService } from "@main/services/persistence";
import { SignalService } from "@main/services/SignalService";
import { ScraperService } from "@main/services/scraper/ScraperService";
import { createMediaRoot } from "@mdcz/media-store";
import { PersistentCooldownStore } from "@mdcz/runtime/cooldown";
import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import { NetworkClient } from "@mdcz/runtime/network";
import { ActorImageService } from "@mdcz/runtime/scrape";
import { afterEach, describe, expect, it, vi } from "vitest";

const directories: string[] = [];
const persistenceServices: DesktopPersistenceService[] = [];

const createHarness = async () => {
  const directory = await mkdtemp(join(tmpdir(), "mdcz-scraper-snapshot-"));
  directories.push(directory);
  const persistence = new DesktopPersistenceService(join(directory, "mdcz.sqlite"), null);
  persistenceServices.push(persistence);
  const networkClient = new NetworkClient();
  const service = new ScraperService(
    new SignalService(null),
    networkClient,
    new CrawlerProvider({ fetchGateway: new FetchGateway(networkClient) }),
    new ActorImageService({ cacheRoot: join(directory, "actors"), networkClient }),
    undefined,
    new PersistentCooldownStore({ filePath: join(directory, "image-host-cooldowns.json") }),
    undefined,
    persistence,
  );
  return { directory, persistence, service };
};

const seedFailedFinalizedRun = async (directory: string, persistence: DesktopPersistenceService) => {
  const mediaRoot = join(directory, "media");
  await mkdir(mediaRoot, { recursive: true });
  const root = createMediaRoot({ id: "desktop-input", displayName: "Input", hostPath: mediaRoot });
  const state = await persistence.getState();
  await state.repositories.mediaRoots.upsert(root);
  const completedAt = new Date("2026-08-28T00:05:00.000Z");
  const run = await state.repositories.scrapeRuns.create({
    rootId: root.id,
    executionMode: "single",
    createdAt: new Date("2026-08-28T00:00:00.000Z"),
    items: [{ ordinal: 0, rootId: root.id, relativePath: "ABC-001.mp4" }],
  });
  await state.repositories.scrapeRuns.finalize({
    runId: run.id,
    disposition: "failed",
    startedAt: new Date("2026-08-28T00:01:00.000Z"),
    completedAt,
    failedCount: 1,
    error: "latest failure",
  });
};

describe("ScraperService.getSnapshot", () => {
  afterEach(async () => {
    await Promise.all(persistenceServices.splice(0).map(async (service) => await service.close()));
    await Promise.all(
      directories.splice(0).map(async (directory) => await rm(directory, { recursive: true, force: true })),
    );
  });

  it("does not restore a finalized single-file run as the active snapshot", async () => {
    const { directory, persistence, service } = await createHarness();
    await seedFailedFinalizedRun(directory, persistence);
    const initialize = vi.spyOn(persistence, "initialize");
    expect(await Promise.all([service.getSnapshot(), service.getSnapshot()])).toEqual([null, null]);
    expect(initialize).toHaveBeenCalledOnce();
  });
});

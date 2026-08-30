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
import type { ScrapeRunSnapshot } from "@mdcz/runtime/tasks";
import { afterEach, describe, expect, it } from "vitest";

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

const seedFinalizedRun = async (
  directory: string,
  persistence: DesktopPersistenceService,
  disposition: "completed" | "failed",
) => {
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
  const attempt = state.repositories.scrapeRuns.admitAttempt(run.items[0].id);
  if (disposition === "failed") {
    await state.repositories.scrapeRuns.commitOutcome({
      outcome: "failed",
      attemptId: attempt.id,
      error: "latest failure",
    });
  } else {
    const crawlerDataJson = JSON.stringify({ title: "Movie", number: "ABC-001", actors: [] });
    state.repositories.scrapeRuns.commitSuccessOutcome({
      outcome: "success",
      attemptId: attempt.id,
      crawlerDataJson,
      nfoRootId: null,
      nfoRelativePath: "ABC-001.nfo",
      outputRootId: root.id,
      outputRelativePath: "ABC-001.mp4",
      uncensoredAmbiguous: false,
      size: 5,
      completedAt,
      libraryEntry: {
        mediaIdentity: "ABC-001",
        rootId: root.id,
        rootRelativePath: "ABC-001.mp4",
        title: "Movie",
        number: "ABC-001",
        actors: [],
        crawlerDataJson,
        createdAt: completedAt,
        assets: [],
      },
    });
  }
  await state.repositories.scrapeRuns.finalize({
    runId: run.id,
    disposition,
    startedAt: new Date("2026-08-28T00:01:00.000Z"),
    completedAt,
  });
};

const attachLiveRun = (service: ScraperService, status: "running" | "paused") => {
  const startedAt = new Date("2026-08-29T00:01:00.000Z");
  const snapshot: ScrapeRunSnapshot = {
    runId: "live-run",
    generation: 1,
    status,
    progress: { percent: 0, completedItems: 0, totalItems: 1 },
    items: [
      {
        id: "item-1",
        rootId: "desktop-input",
        relativePath: "ABC-001.mp4",
        sourcePath: "/media/ABC-001.mp4",
        status: "processing",
        error: null,
      },
    ],
    latestStage: null,
    logs: [],
    error: null,
  };
  Object.assign(service, {
    workflow: {
      liveRuns: () => [
        {
          run: {
            id: snapshot.runId,
            rootId: "desktop-input",
            createdAt: startedAt,
            completedAt: null,
            items: snapshot.items.map((item) => ({
              id: item.id,
              rootId: item.rootId,
              relativePath: item.relativePath,
            })),
          },
          snapshot,
          startedAt,
        },
      ],
    },
  });
  return snapshot;
};

describe("ScraperService.getSnapshot", () => {
  afterEach(async () => {
    await Promise.all(persistenceServices.splice(0).map(async (service) => await service.close()));
    await Promise.all(
      directories.splice(0).map(async (directory) => await rm(directory, { recursive: true, force: true })),
    );
  });

  it("returns null when there is no in-process run", async () => {
    const { service } = await createHarness();
    expect(await service.getSnapshot()).toBeNull();
  });

  it("returns null when the latest SQLite run succeeded", async () => {
    const { directory, persistence, service } = await createHarness();
    await seedFinalizedRun(directory, persistence, "completed");
    expect(await service.getSnapshot()).toBeNull();
  });

  it("returns null when the latest SQLite run failed", async () => {
    const { directory, persistence, service } = await createHarness();
    await seedFinalizedRun(directory, persistence, "failed");
    expect(await service.getSnapshot()).toBeNull();
  });

  it("returns a running in-process run", async () => {
    const { service } = await createHarness();
    attachLiveRun(service, "running");
    const snapshot = await service.getSnapshot();
    expect(snapshot?.task.id).toBe("live-run");
    expect(snapshot?.task.status).toBe("running");
    expect(snapshot?.task.continuity).toBe("live");
  });

  it("returns a paused in-process run", async () => {
    const { service } = await createHarness();
    attachLiveRun(service, "paused");
    const snapshot = await service.getSnapshot();
    expect(snapshot?.task.id).toBe("live-run");
    expect(snapshot?.task.status).toBe("paused");
    expect(snapshot?.task.continuity).toBe("live");
  });
});

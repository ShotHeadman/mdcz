import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesktopPersistenceService } from "@main/services/persistence";
import { SignalService } from "@main/services/SignalService";
import { ScraperService } from "@main/services/scraper/ScraperService";
import { createMediaRoot } from "@mdcz/media-store";
import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import { NetworkClient } from "@mdcz/runtime/network";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
const persistenceServices: DesktopPersistenceService[] = [];

const createHarness = async () => {
  const directory = await mkdtemp(join(tmpdir(), "mdcz-scraper-snapshot-"));
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
  return { directory, persistence, service };
};

const seedFinalizedSuccess = async (
  directory: string,
  persistence: DesktopPersistenceService,
  uncensoredAmbiguous: boolean,
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
  const crawlerDataJson = JSON.stringify({ title: "Movie", number: "ABC-001", actors: [] });
  state.repositories.scrapeRuns.commitSuccessOutcome({
    outcome: "success",
    attemptId: attempt.id,
    crawlerDataJson,
    nfoRootId: null,
    nfoRelativePath: "ABC-001.nfo",
    outputRootId: root.id,
    outputRelativePath: "ABC-001.mp4",
    uncensoredAmbiguous,
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
      assets: [
        { kind: "poster", uri: "ABC-001/poster.jpg", rootId: root.id, relativePath: "ABC-001/poster.jpg" },
        { kind: "trailer", uri: "https://example.test/trailer.mp4" },
      ],
    },
  });
  await state.repositories.scrapeRuns.finalize({
    runId: run.id,
    disposition: "completed",
    startedAt: new Date("2026-08-28T00:01:00.000Z"),
    completedAt,
  });
  return completedAt;
};

describe("ScraperService.getSnapshot", () => {
  afterEach(async () => {
    await Promise.all(persistenceServices.splice(0).map(async (service) => await service.close()));
    await Promise.all(
      directories.splice(0).map(async (directory) => await rm(directory, { recursive: true, force: true })),
    );
  });

  it("returns null when there is no live run and no history", async () => {
    const { service } = await createHarness();
    expect(await service.getSnapshot()).toBeNull();
  });

  it("does not surface a successful finalized run that needs no follow-up", async () => {
    const { directory, persistence, service } = await createHarness();
    await seedFinalizedSuccess(directory, persistence, false);
    expect(await service.getSnapshot()).toBeNull();
  });

  it("projects the last finalized run from the repository", async () => {
    const { directory, persistence, service } = await createHarness();
    const mediaRoot = join(directory, "media");
    await mkdir(mediaRoot, { recursive: true });
    await writeFile(join(mediaRoot, "ABC-001.mp4"), "video");
    const root = createMediaRoot({ id: "desktop-input", displayName: "Input", hostPath: mediaRoot });
    const state = await persistence.getState();
    await state.repositories.mediaRoots.upsert(root);
    const first = await state.repositories.scrapeRuns.create({
      rootId: root.id,
      executionMode: "single",
      createdAt: new Date("2026-08-27T00:00:00.000Z"),
      items: [{ ordinal: 0, rootId: root.id, relativePath: "OLD.mp4" }],
    });
    const firstAttempt = state.repositories.scrapeRuns.admitAttempt(first.items[0].id);
    await state.repositories.scrapeRuns.commitOutcome({
      outcome: "failed",
      attemptId: firstAttempt.id,
      error: "old failure",
    });
    await state.repositories.scrapeRuns.finalize({
      runId: first.id,
      disposition: "failed",
      startedAt: new Date("2026-08-27T00:01:00.000Z"),
    });
    const last = await state.repositories.scrapeRuns.create({
      rootId: root.id,
      executionMode: "single",
      createdAt: new Date("2026-08-28T00:00:00.000Z"),
      items: [{ ordinal: 0, rootId: root.id, relativePath: "ABC-001.mp4" }],
    });
    const attempt = state.repositories.scrapeRuns.admitAttempt(last.items[0].id);
    await state.repositories.scrapeRuns.commitOutcome({
      outcome: "failed",
      attemptId: attempt.id,
      error: "latest failure",
    });
    await state.repositories.scrapeRuns.finalize({
      runId: last.id,
      disposition: "failed",
      startedAt: new Date("2026-08-28T00:01:00.000Z"),
    });

    const snapshot = await service.getSnapshot();
    expect(snapshot?.task.id).toBe(last.id);
    expect(snapshot?.task.continuity).toBe("final");
    expect(snapshot?.items).toEqual([
      expect.objectContaining({ relativePath: "ABC-001.mp4", status: "failed", error: "latest failure" }),
    ]);
  });

  it("reconstructs assets, nfo root, and persisted completion time from follow-up history", async () => {
    const { directory, persistence, service } = await createHarness();
    const completedAt = await seedFinalizedSuccess(directory, persistence, true);

    const first = await service.getSnapshot();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await service.getSnapshot();

    expect(first?.task.completedAt).toBe(completedAt.toISOString());
    expect(second?.task.completedAt).toBe(first?.task.completedAt);
    expect(second?.task.updatedAt).toBe(first?.task.updatedAt);
    expect(first?.items).toEqual([
      expect.objectContaining({
        status: "success",
        nfoRootId: "desktop-input",
        nfoRelativePath: "ABC-001.nfo",
        assets: [
          { type: "local", kind: "poster", file: { rootId: "desktop-input", relativePath: "ABC-001/poster.jpg" } },
          { type: "remote", kind: "trailer", url: "https://example.test/trailer.mp4" },
        ],
      }),
    ]);
  });
});

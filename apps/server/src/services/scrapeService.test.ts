import { createMediaRoot } from "@mdcz/media-store";
import type { ScrapeRunManifest } from "@mdcz/persistence";
import type { MountedRootScrapeRuntime } from "@mdcz/runtime/scrape";
import { defaultConfiguration } from "@mdcz/shared/config";
import { describe, expect, it, vi } from "vitest";
import { TaskEventBus } from "../taskEvents";
import type { ServerConfigService } from "./configService";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";
import { ScrapeService } from "./scrapeService";

const root = createMediaRoot({ id: "root-1", displayName: "Media", hostPath: "/media" });

const manifest: ScrapeRunManifest = {
  id: "unsubmitted-run",
  rootId: root.id,
  outputRootId: null,
  executionMode: "single",
  createdAt: new Date("2026-08-25T00:00:00.000Z"),
  items: [
    {
      id: "unsubmitted-item",
      runId: "unsubmitted-run",
      ordinal: 0,
      rootId: root.id,
      relativePath: "ABC-001.mp4",
      manualUrl: null,
      uncensoredChoice: null,
    },
  ],
};

const createService = (discardUnstartedRun: () => Promise<void>) => {
  const scrapeRuns = {
    createRun: vi.fn(async () => manifest),
    discardUnstartedRun: vi.fn(discardUnstartedRun),
  };
  const persistence = {
    getState: vi.fn(async () => ({ repositories: { scrapeRuns } })),
  };
  const roots = { getActiveRoot: vi.fn(async () => root) };
  const config = { get: vi.fn(async () => defaultConfiguration) };
  const service = new ScrapeService(
    persistence as unknown as ServerPersistenceService,
    roots as unknown as MediaRootService,
    config as unknown as ServerConfigService,
    new TaskEventBus(),
    {} as MountedRootScrapeRuntime,
  );
  return { service, scrapeRuns };
};

describe("ScrapeService queue admission", () => {
  it("discards a newly persisted run when the queue is already closing", async () => {
    const { service, scrapeRuns } = createService(async () => undefined);
    await service.close();

    await expect(service.start({ refs: [{ rootId: root.id, relativePath: "ABC-001.mp4" }] })).rejects.toThrow(
      "Scrape queue is closing",
    );

    expect(scrapeRuns.createRun).toHaveBeenCalledOnce();
    expect(scrapeRuns.discardUnstartedRun).toHaveBeenCalledWith(manifest.id);
  });

  it("reports failed cleanup as an unsuccessful submission", async () => {
    const { service, scrapeRuns } = createService(async () => {
      throw new Error("database unavailable");
    });
    await service.close();

    await expect(service.start({ refs: [{ rootId: root.id, relativePath: "ABC-001.mp4" }] })).rejects.toThrow(
      "Scrape task was not submitted and cleanup failed: database unavailable",
    );

    expect(scrapeRuns.discardUnstartedRun).toHaveBeenCalledWith(manifest.id);
  });
});

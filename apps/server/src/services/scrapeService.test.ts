import { createMediaRoot } from "@mdcz/media-store";
import type { ScrapeRunRecord } from "@mdcz/persistence";
import { defaultConfiguration } from "@mdcz/shared/config";
import { describe, expect, it, vi } from "vitest";
import { TaskEventBus } from "../taskEvents";
import type { ServerConfigService } from "./configService";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";
import { ScrapeService } from "./scrapeService";

const root = createMediaRoot({ id: "root-1", displayName: "Media", hostPath: "/media" });

const manifest: ScrapeRunRecord = {
  id: "unsubmitted-run",
  previousRunId: null,
  rootId: root.id,
  requestedOutputRootId: null,
  requestedOutputRelativeDirectory: null,
  executionMode: "single",
  directoryScopeJson: null,
  configurationJson: JSON.stringify(defaultConfiguration),
  manifestFixedAt: new Date(),
  discoveryJson: null,
  createdAt: new Date("2026-08-25T00:00:00.000Z"),
  startedAt: null,
  completedAt: null,
  disposition: null,
  error: null,
  items: [
    {
      id: "unsubmitted-item",
      runId: "unsubmitted-run",
      ordinal: 0,
      rootId: root.id,
      relativePath: "ABC-001.mp4",
      manualUrl: null,
      uncensoredChoice: null,
      status: null,
      errorMessage: null,
      uncensoredAmbiguous: false,
      libraryFileId: null,
      completedAt: null,
    },
  ],
};

const createService = () => {
  const scrapeRuns = {
    create: vi.fn(async () => manifest),
  };
  const persistence = {
    initialize: vi.fn(async () => ({ repositories: { scrapeRuns, library: {}, publicationJournal: {} } })),
    getState: vi.fn(async () => ({ repositories: { scrapeRuns } })),
  };
  const roots = { get: vi.fn(async () => root) };
  const config = { get: vi.fn(async () => defaultConfiguration) };
  const service = new ScrapeService(
    persistence as unknown as ServerPersistenceService,
    roots as unknown as MediaRootService,
    config as unknown as ServerConfigService,
    new TaskEventBus(),
    {
      networkClient: { setDomainInterval: vi.fn() } as never,
      crawlerProvider: {} as never,
      imageHostCooldownStore: { clear: vi.fn(), flush: vi.fn() } as never,
      actorImageService: {} as never,
    },
  );
  return { service, scrapeRuns };
};

describe("ScrapeService queue admission", () => {
  it("rejects a run before persistence when the queue is closing", async () => {
    const { service, scrapeRuns } = createService();
    await service.close();

    await expect(
      service.start({ executionMode: "single", refs: [{ rootId: root.id, relativePath: "ABC-001.mp4" }] }),
    ).rejects.toThrow("Scrape queue is closing");

    expect(scrapeRuns.create).not.toHaveBeenCalled();
  });
});

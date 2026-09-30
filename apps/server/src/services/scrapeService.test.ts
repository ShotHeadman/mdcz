import { tmpdir } from "node:os";
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
  totalItems: 1,
  successCount: 0,
  failedCount: 0,
  skippedCount: 0,
  totalBytes: 0,
  createdAt: new Date("2026-08-25T00:00:00.000Z"),
  startedAt: null,
  completedAt: null,
  disposition: null,
  error: null,
  items: [
    {
      id: "unsubmitted-item",
      ordinal: 0,
      rootId: root.id,
      relativePath: "ABC-001.mp4",
      manualUrl: null,
      uncensoredChoice: null,
    },
  ],
};

const createService = () => {
  const scrapeRuns = {
    create: vi.fn(async () => manifest),
  };
  const persistence = {
    initialize: vi.fn(async () => ({ repositories: { scrapeRuns, library: {} } })),
    getState: vi.fn(async () => ({ repositories: { scrapeRuns } })),
  };
  const roots = { get: vi.fn(async () => root) };
  const config = { get: vi.fn(async () => defaultConfiguration), runtimePaths: { dataDir: tmpdir() } };
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
  return { service, scrapeRuns, persistence };
};

describe("ScrapeService queue admission", () => {
  it("rejects a run before persistence when the queue is closing", async () => {
    const { service, scrapeRuns, persistence } = createService();
    const initialize = persistence.initialize;
    const [first, second] = await Promise.all([
      (service as unknown as { runner(): Promise<unknown> }).runner(),
      (service as unknown as { runner(): Promise<unknown> }).runner(),
    ]);
    expect(first).toBe(second);
    expect(initialize).toHaveBeenCalledOnce();
    await service.close();

    await expect(
      service.start({ executionMode: "single", refs: [{ rootId: root.id, relativePath: "ABC-001.mp4" }] }),
    ).rejects.toThrow("Scrape queue is closing");

    expect(scrapeRuns.create).not.toHaveBeenCalled();
  });
});

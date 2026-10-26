import { tmpdir } from "node:os";
import { createMediaRoot } from "@mdcz/media-store";
import type { MediaLibraryRecord, ScrapeRunRecord } from "@mdcz/persistence";
import { LibraryTaskGate } from "@mdcz/runtime/tasks";
import { defaultConfiguration } from "@mdcz/shared/config";
import type { ScrapeStartInput } from "@mdcz/shared/serverDtos";
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
  libraryId: "library-1",
  rootId: root.id,
  requestedOutputRootId: null,
  requestedOutputRelativeDirectory: null,
  executionMode: "single",
  directoryScopeJson: null,
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

const library = {
  id: "library-1",
  placement: "inPlace",
  automation: "off",
  discovery: "events",
  outputPath: "",
  folderTemplate: "",
  fileTemplate: "",
} as MediaLibraryRecord;

const createService = () => {
  const scrapeRuns = {
    create: vi.fn(async () => manifest),
  };
  const mediaLibraries = { get: vi.fn(() => library) };
  const persistence = {
    initialize: vi.fn(async () => ({ repositories: { scrapeRuns, library: {}, mediaLibraries } })),
    getState: vi.fn(async () => ({ repositories: { scrapeRuns } })),
  };
  const roots = { get: vi.fn(async () => root) };
  const config = { get: vi.fn(async () => defaultConfiguration), runtimePaths: { dataDir: tmpdir() } };
  const taskGate = new LibraryTaskGate();
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
      taskGate,
    },
  );
  return { service, scrapeRuns, persistence, taskGate };
};

describe("ScrapeService queue admission", () => {
  it("rejects a run before persistence while maintenance is live or the queue is closing", async () => {
    const { service, scrapeRuns, persistence, taskGate } = createService();
    const input: ScrapeStartInput = {
      executionMode: "single",
      libraryId: library.id,
      refs: [{ rootId: root.id, relativePath: "ABC-001.mp4" }],
    };
    const initialize = persistence.initialize;
    const [first, second] = await Promise.all([
      (service as unknown as { runner(): Promise<unknown> }).runner(),
      (service as unknown as { runner(): Promise<unknown> }).runner(),
    ]);
    expect(first).toBe(second);
    expect(initialize).toHaveBeenCalledOnce();

    taskGate.track("maintenance", () => true);
    await expect(service.start(input)).rejects.toThrow("A maintenance task is running");

    await service.close();
    await expect(service.start(input)).rejects.toThrow("Scrape queue is closing");

    expect(scrapeRuns.create).not.toHaveBeenCalled();
  });
});

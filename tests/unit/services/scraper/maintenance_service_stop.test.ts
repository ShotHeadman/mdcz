import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { configManager, defaultConfiguration } from "@main/services/config";
import { DesktopPersistenceService } from "@main/services/persistence";
import { SignalService } from "@main/services/SignalService";
import { MaintenanceService } from "@main/services/scraper/maintenance/MaintenanceService";
import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import type { MaintenanceRuntime } from "@mdcz/runtime/maintenance";
import { NetworkClient } from "@mdcz/runtime/network";
import type { LocalScanEntry } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

class CaptureSignalService extends SignalService {}

const tempPaths: string[] = [];
const fixtureCleanups: Array<() => Promise<void>> = [];

const createEntry = (filePath: string, fileId = "ABP-123"): LocalScanEntry => ({
  fileId,
  ref: { rootId: "test-root", relativePath: path.basename(filePath) },
  fileInfo: {
    filePath,
    fileName: path.basename(filePath),
    extension: path.extname(filePath),
    number: fileId,
    isSubtitled: false,
  },
  crawlerData: {
    title: "old title",
    number: fileId,
    actors: [],
    genres: [],
    scene_images: [],
  },
  assets: { sceneImages: [], actorPhotos: [] },
  currentDir: path.dirname(filePath),
});

const createFixture = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "mdcz-maintenance-facade-"));
  tempPaths.push(directory);
  const filePath = path.join(directory, "ABP-123.mp4");
  await writeFile(filePath, "video");
  const entry = createEntry(filePath);
  const runtime = {
    scan: vi.fn(async () => [entry]),
    scanFilePaths: vi.fn(async () => [entry]),
    scanRefs: vi.fn(async () => [entry]),
    previewEntries: vi.fn(async ({ root }: { root: { id: string } }) => [
      {
        entry,
        rootId: root.id,
        relativePath: path.basename(filePath),
        status: "ready" as const,
        error: null,
        fieldDiffs: [
          {
            kind: "value" as const,
            field: "title" as const,
            label: "标题",
            oldValue: "old title",
            newValue: "new title",
            changed: true,
          },
        ],
        unchangedFieldDiffs: [],
        pathDiff: null,
        proposedCrawlerData: {
          title: "new title",
          number: "ABP-123",
          actors: [],
          genres: [],
          scene_images: [],
        },
      },
    ]),
    applyEntry: vi.fn(),
  } as unknown as MaintenanceRuntime;
  const signalService = new CaptureSignalService(null);
  const networkClient = new NetworkClient();
  const persistenceService = new DesktopPersistenceService(path.join(directory, "mdcz.sqlite"), null);
  const root = await (await persistenceService.initialize()).repositories.mediaRoots.ensurePath(directory);
  entry.ref = { rootId: root.id, relativePath: path.basename(filePath) };
  const service = new MaintenanceService({
    signalService,
    networkClient,
    crawlerProvider: new CrawlerProvider({ fetchGateway: new FetchGateway(networkClient) }),
    persistenceService,
    runtime,
  });
  vi.spyOn(configManager, "getValidated").mockResolvedValue({
    ...defaultConfiguration,
    paths: { ...defaultConfiguration.paths, mediaPath: directory },
  });
  fixtureCleanups.push(async () => {
    await service.shutdown();
    await persistenceService.close();
  });
  return { directory, entry, filePath, persistenceService, runtime, service, signalService };
};

describe("desktop maintenance facade", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const cleanup of fixtureCleanups.splice(0)) await cleanup();
    for (const target of tempPaths.splice(0)) await rm(target, { recursive: true, force: true });
  });

  it("returns execute acknowledgement timing before deferred apply settles and maps committed fields", async () => {
    const fixture = await createFixture();
    const previewHandle = await fixture.service.startPreview([fixture.entry.ref], "refresh_data");
    const preview = (await previewHandle.completion).items[0];
    expect(preview).toBeDefined();

    let release!: () => void;
    const deferred = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(fixture.runtime.applyEntry).mockImplementation(async (input) => {
      await deferred;
      return {
        status: "success",
        entry: fixture.entry,
        crawlerData: input.committed?.crawlerData,
        outputRelativePath: path.basename(fixture.filePath),
      };
    });
    const handle = await fixture.service.execute(
      previewHandle.session.id,
      [{ previewId: preview?.id ?? "", fieldSelections: { title: "old" } }],
      "refresh_data",
    );
    expect(vi.mocked(fixture.runtime.applyEntry)).not.toHaveBeenCalled();

    release();
    await handle.completion;
    expect(vi.mocked(fixture.runtime.applyEntry).mock.calls[0]?.[0].committed?.crawlerData?.title).toBe("old title");
  });
});

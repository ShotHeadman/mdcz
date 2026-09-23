import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { configManager, defaultConfiguration } from "@main/services/config";
import { DesktopPersistenceService } from "@main/services/persistence";
import { SignalService } from "@main/services/SignalService";
import { MaintenanceService } from "@main/services/scraper/maintenance/MaintenanceService";
import { PersistentCooldownStore } from "@mdcz/runtime/cooldown";
import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import type { MaintenanceRuntime } from "@mdcz/runtime/maintenance";
import { NetworkClient } from "@mdcz/runtime/network";
import { ActorImageService } from "@mdcz/runtime/scrape";
import type { LocalScanEntry } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

class CaptureSignalService extends SignalService {
  override publishTaskSnapshot = vi.fn<SignalService["publishTaskSnapshot"]>();
}

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
    getConfiguration: vi.fn(async () => defaultConfiguration),
    scanRefs: vi.fn(async () => [entry]),
    previewMovie: vi.fn(
      async ({ root, entry, files }: { root: { id: string }; entry: LocalScanEntry; files: LocalScanEntry[] }) => ({
        entry,
        files,
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
        affectedFiles: files.map((file) => ({
          fileId: file.fileId,
          currentPath: file.fileInfo.filePath,
          targetPath: file.fileInfo.filePath,
        })),
        proposedCrawlerData: {
          title: "new title",
          number: "ABP-123",
          actors: [],
          genres: [],
          scene_images: [],
        },
      }),
    ),
    previewPaths: vi.fn(async ({ files }: { files: LocalScanEntry[] }) => ({
      pathDiff: null,
      affectedFiles: files.map((file) => ({
        fileId: file.fileId,
        currentPath: file.fileInfo.filePath,
        targetPath: file.fileInfo.filePath,
      })),
    })),
    applyEntry: vi.fn(),
  } as unknown as MaintenanceRuntime;
  runtime.createSession = vi.fn(async () => runtime);
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
    actorImageService: new ActorImageService({ cacheRoot: path.join(directory, "actors"), networkClient }),
    imageHostCooldownStore: new PersistentCooldownStore({
      filePath: path.join(directory, "image-host-cooldowns.json"),
    }),
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
    const previewHandle = await fixture.service.startPreview([fixture.entry.ref], "refresh_metadata");
    const preview = (await previewHandle.completion).items[0];
    expect(preview).toBeDefined();
    expect(previewHandle.session).toMatchObject({ phase: "preview", refs: [fixture.entry.ref] });
    expect(fixture.signalService.publishTaskSnapshot).toHaveBeenCalledWith({
      resource: "maintenance",
      snapshot: expect.objectContaining({
        status: "completed",
        completedEntries: 1,
        previews: [expect.objectContaining({ id: preview?.id })],
      }),
    });

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
      [{ previewId: preview?.id ?? "", fieldSelections: { title: "old" } }],
      "refresh_metadata",
    );
    expect(vi.mocked(fixture.runtime.applyEntry)).not.toHaveBeenCalled();

    release();
    await handle.completion;
    expect(vi.mocked(fixture.runtime.applyEntry).mock.calls[0]?.[0].committed?.crawlerData?.title).toBe("old title");
    expect(fixture.signalService.publishTaskSnapshot).toHaveBeenLastCalledWith({
      resource: "maintenance",
      snapshot: expect.objectContaining({ phase: "apply", status: "completed", completedEntries: 1 }),
    });
  });
});

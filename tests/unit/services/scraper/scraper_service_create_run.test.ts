import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfiguration } from "@main/services/config";
import { createDesktopMediaRootService } from "@main/services/mediaRoots";
import { DesktopPersistenceService } from "@main/services/persistence";
import { SignalService } from "@main/services/SignalService";
import { ScraperService } from "@main/services/scraper/ScraperService";
import { createMediaRoot } from "@mdcz/media-store";
import { PersistentCooldownStore } from "@mdcz/runtime/cooldown";
import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import { MediaLibraryService } from "@mdcz/runtime/library";
import { NetworkClient } from "@mdcz/runtime/network";
import { ActorImageService, FileScraper } from "@mdcz/runtime/scrape";
import { DirectoryInventory } from "@mdcz/runtime/scrape/DirectoryInventory";
import { admitScrapeGroups } from "@mdcz/runtime/scrape/movieGroups";
import type { MediaLibrarySettingsInput } from "@mdcz/shared/mediaLibrary";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockConfigManager } from "../../../helpers/scraper";

const resources: { directory: string; persistence: DesktopPersistenceService; service: ScraperService }[] = [];
afterEach(async () => {
  for (const { directory, persistence, service } of resources.splice(0)) {
    await service.shutdown({ timeoutMs: 1_000 });
    await persistence.close();
    await rm(directory, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

const createHarness = async () => {
  const directory = await mkdtemp(join(tmpdir(), "mdcz-scrape-admission-"));
  const persistence = new DesktopPersistenceService(join(directory, "mdcz.sqlite"), null);
  const networkClient = new NetworkClient();
  const libraries = new MediaLibraryService(
    async () => (await persistence.getState()).repositories.mediaLibraries,
    createDesktopMediaRootService(persistence),
    async () => defaultConfiguration,
  );
  const service = new ScraperService(
    new SignalService(null),
    networkClient,
    new CrawlerProvider({ fetchGateway: new FetchGateway(networkClient) }),
    new ActorImageService({ cacheRoot: join(directory, "actors"), networkClient }),
    undefined,
    new PersistentCooldownStore({ filePath: join(directory, "cooldowns.json") }),
    libraries,
    undefined,
    persistence,
  );
  resources.push({ directory, persistence, service });
  mockConfigManager(defaultConfiguration);
  const createLibrary = async (sourcePath: string, overrides: Partial<MediaLibrarySettingsInput> = {}) => {
    await mkdir(sourcePath, { recursive: true });
    return await libraries.create({
      name: "Library",
      sourcePath,
      outputPath: join(directory, "library"),
      placement: "move",
      ...overrides,
    });
  };
  const prepare = vi.spyOn(FileScraper.prototype, "prepareGroup").mockImplementation(async (entries) => ({
    fileId: entries[0]?.filePath ?? "",
    rootId: entries[0]?.options.source?.rootId ?? "local",
    relativePath: entries[0]?.options.source?.relativePath ?? entries[0]?.filePath ?? "",
    fileName: entries[0]?.filePath ?? "",
    status: "failed",
    error: "metadata unavailable",
    assets: [],
  }));
  return { directory, persistence, service, prepare, createLibrary };
};

describe("scrape admission and grouping", () => {
  it.each([
    "files",
    "empty",
    "missing",
  ] as const)("validates directory admission before discovery (%s)", async (kind) => {
    const { directory, persistence, service, prepare, createLibrary } = await createHarness();
    const library = await createLibrary(join(directory, "downloads"));
    const source = join(directory, "downloads", "source");
    if (kind !== "missing") await mkdir(source);
    if (kind === "files") {
      for (const name of ["ABC-123-CD1.mp4", "ABC-123-CD2.mp4", "ABC-123-CD1.strm", "trailer.mp4"])
        await writeFile(join(source, name), "content");
    }
    const start = () =>
      service.start({
        executionMode: "batch",
        libraryId: library.id,
        source: { kind: "directory", scanDir: source, recursive: true },
      });
    if (kind === "missing") {
      await expect(start()).rejects.toThrow("Directory does not exist or is inaccessible");
      expect(prepare).not.toHaveBeenCalled();
      return;
    }
    const launch = await start();
    expect(launch.snapshot.task.totalItems).toBeNull();
    await service.waitForIdle();
    const manifest = await (await persistence.getState()).repositories.scrapeRuns.get(launch.taskId);
    expect(manifest.items.map((item) => item.relativePath)).toEqual(
      kind === "files" ? ["source/ABC-123-CD1.mp4", "source/ABC-123-CD2.mp4"] : [],
    );
    expect(manifest.manifestFixedAt).not.toBeNull();
    expect(manifest.disposition).toBe(kind === "empty" ? "completed" : "failed");
    expect(prepare).toHaveBeenCalledTimes(kind === "files" ? 1 : 0);
    if (kind === "files") {
      expect(prepare.mock.calls[0][0]).toHaveLength(2);
      const state = await persistence.getState();
      const sourceRoot = await state.repositories.mediaRoots.ensurePath(source);
      for (const name of ["ABC-123.mp4", "ABC-123-part1.mp4"]) await writeFile(join(source, name), "video");
      for (const names of [
        ["ABC-123-CD1.mp4", "ABC-123.mp4"],
        ["ABC-123-CD1.mp4", "ABC-123-part1.mp4"],
      ]) {
        const ambiguous = await service.start({
          executionMode: "batch",
          libraryId: library.id,
          refs: names.map((relativePath) => ({ rootId: sourceRoot.id, relativePath })),
        });
        await service.waitForIdle();
        const rejected = await state.repositories.scrapeRuns.get(ambiguous.taskId);
        expect(rejected.disposition).toBe("failed");
        expect(prepare).toHaveBeenCalledOnce();
      }
    }
  });

  it("deduplicates selections and packs only local non-contiguous parts without querying library ownership", async () => {
    const { directory, persistence, service, prepare, createLibrary } = await createHarness();
    const library = await createLibrary(join(directory, "downloads"));
    const state = await persistence.getState();
    const paths = [join(directory, "a"), join(directory, "b")];
    for (const path of paths) await mkdir(path);
    for (const part of [1, 2, 4]) await writeFile(join(paths[0], `ABC-123-CD${part}.mp4`), "local part");
    await writeFile(join(paths[1], "ABC-123-CD8.mp4"), "archived part");
    const roots = await Promise.all(
      paths.map((hostPath, index) =>
        state.repositories.mediaRoots.upsert(
          createMediaRoot({ id: `root-${index}`, displayName: String(index), hostPath }),
        ),
      ),
    );
    const parent = await state.repositories.mediaRoots.upsert(
      createMediaRoot({ id: "parent", displayName: "Parent", hostPath: directory }),
    );
    await state.repositories.library.upsertEntry({
      movie: { number: "ABC-123", title: "Library movie" },
      files: [
        { rootId: roots[0].id, rootRelativePath: "ABC-123-CD2.mp4", fileId: "one" },
        { rootId: roots[1].id, rootRelativePath: "ABC-123-CD8.mp4", fileId: "two" },
      ],
    });
    const ownership = vi.spyOn(state.repositories.library, "inventoryOwnership");
    const launch = await service.start({
      executionMode: "batch",
      libraryId: library.id,
      refs: [
        { rootId: roots[0].id, relativePath: "ABC-123-CD2.mp4" },
        { rootId: parent.id, relativePath: "a/ABC-123-CD2.mp4" },
      ],
    });
    await service.waitForIdle();
    const manifest = await state.repositories.scrapeRuns.get(launch.taskId);
    expect(manifest.items.map(({ rootId, relativePath }) => ({ rootId, relativePath }))).toEqual([
      { rootId: roots[0].id, relativePath: "ABC-123-CD2.mp4" },
      { rootId: roots[0].id, relativePath: "ABC-123-CD1.mp4" },
      { rootId: roots[0].id, relativePath: "ABC-123-CD4.mp4" },
    ]);
    expect(ownership).not.toHaveBeenCalled();
    expect(prepare).toHaveBeenCalledOnce();
    expect(prepare.mock.calls[0][0]).toHaveLength(3);
  });

  it.each([
    "single",
    "batch",
  ] as const)("admits the source, the library's metadata output, and the manual route (%s)", async (executionMode) => {
    const { directory, persistence, service, prepare, createLibrary } = await createHarness();
    const source = join(directory, "source");
    const metadata = join(directory, "metadata");
    const library = await createLibrary(source, { placement: "metadataOnly", outputPath: metadata });
    await writeFile(join(source, "ABC-123.mp4"), "video");
    const state = await persistence.getState();
    const sourceRoot = await state.repositories.mediaRoots.ensurePath(source);
    const ref = { rootId: sourceRoot.id, relativePath: "ABC-123.mp4" };
    const manualUrl =
      executionMode === "single" ? "https://www.dmm.co.jp/mono/dvd/-/detail/=/cid=abc00123/" : undefined;
    const launch = await service.start({ executionMode, libraryId: library.id, refs: [ref], manualUrl });
    await service.waitForIdle();
    const manifest = await state.repositories.scrapeRuns.get(launch.taskId);
    const options = prepare.mock.calls[0][0][0].options;
    const metadataRoot = (await state.repositories.mediaRoots.list()).find((root) => root.hostPath === metadata);
    expect(manifest).toMatchObject({ libraryId: library.id, requestedOutputRootId: metadataRoot?.id });
    expect(options.target).toEqual({
      placement: "metadataOnly",
      outputPath: metadata,
      folderTemplate: library.folderTemplate,
      fileTemplate: library.fileTemplate,
    });
    expect(options.roots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ hostPath: source }),
        expect.objectContaining({ hostPath: metadata }),
      ]),
    );
    if (executionMode === "single") {
      expect(options.manualScrape?.detailUrl).toBe(manualUrl);
      const admit = async () =>
        await admitScrapeGroups({
          refs: [ref],
          resolveRoot: async () => sourceRoot,
          inventory: new DirectoryInventory(),
          configuration: defaultConfiguration,
        });
      const firstFileId = (await admit())[0].members[0].fileId;
      const secondFileId = (await admit())[0].members[0].fileId;
      expect(firstFileId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
      expect(secondFileId).not.toBe(firstFileId);
    } else expect(options.manualScrape).toBeUndefined();
  });
});

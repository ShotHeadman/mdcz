import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfiguration } from "@main/services/config";
import { DesktopPersistenceService } from "@main/services/persistence";
import { SignalService } from "@main/services/SignalService";
import { ScraperService } from "@main/services/scraper/ScraperService";
import { createMediaRoot } from "@mdcz/media-store";
import { PersistentCooldownStore } from "@mdcz/runtime/cooldown";
import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import { NetworkClient } from "@mdcz/runtime/network";
import { ActorImageService, FileScraper } from "@mdcz/runtime/scrape";
import { DirectoryInventory } from "@mdcz/runtime/scrape/DirectoryInventory";
import { admitScrapeGroups } from "@mdcz/runtime/scrape/movieGroups";
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
  const service = new ScraperService(
    new SignalService(null),
    networkClient,
    new CrawlerProvider({ fetchGateway: new FetchGateway(networkClient) }),
    new ActorImageService({ cacheRoot: join(directory, "actors"), networkClient }),
    undefined,
    new PersistentCooldownStore({ filePath: join(directory, "cooldowns.json") }),
    undefined,
    persistence,
  );
  resources.push({ directory, persistence, service });
  mockConfigManager({
    ...defaultConfiguration,
    paths: { ...defaultConfiguration.paths, mediaPath: join(directory, "library") },
  });
  const prepare = vi.spyOn(FileScraper.prototype, "prepareGroup").mockImplementation(async (entries) => ({
    fileId: entries[0]?.filePath ?? "",
    rootId: entries[0]?.options.source?.rootId ?? "local",
    relativePath: entries[0]?.options.source?.relativePath ?? entries[0]?.filePath ?? "",
    fileName: entries[0]?.filePath ?? "",
    status: "failed",
    error: "metadata unavailable",
    assets: [],
  }));
  return { directory, persistence, service, prepare };
};

describe("scrape admission and grouping", () => {
  it.each([
    "files",
    "empty",
    "missing",
  ] as const)("validates directory admission before discovery (%s)", async (kind) => {
    const { directory, persistence, service, prepare } = await createHarness();
    const source = join(directory, "source");
    if (kind !== "missing") await mkdir(source);
    if (kind === "files") {
      for (const name of ["ABC-123-CD1.mp4", "ABC-123-CD2.mp4", "ABC-123-CD1.strm", "trailer.mp4"])
        await writeFile(join(source, name), "content");
    }
    const start = () =>
      service.start({
        mode: "directory",
        source: { kind: "directory", scanDir: source, recursive: true },
        targetDir: join(directory, "output"),
      });
    if (kind === "missing") {
      await expect(start()).rejects.toThrow("目录不存在或无法访问");
      expect(prepare).not.toHaveBeenCalled();
      return;
    }
    const launch = await start();
    expect(launch.snapshot.task.totalItems).toBeNull();
    await service.waitForIdle();
    const manifest = await (await persistence.getState()).repositories.scrapeRuns.get(launch.taskId);
    expect(manifest.items.map((item) => item.relativePath)).toEqual(
      kind === "files" ? ["ABC-123-CD1.mp4", "ABC-123-CD2.mp4"] : [],
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
          mode: "selection",
          refs: names.map((relativePath) => ({ rootId: sourceRoot.id, relativePath })),
          outputRootId: sourceRoot.id,
        });
        await service.waitForIdle();
        const rejected = await state.repositories.scrapeRuns.get(ambiguous.taskId);
        expect(rejected.disposition).toBe("failed");
        expect(prepare).toHaveBeenCalledOnce();
      }
    }
  });

  it("deduplicates selections and packs only local non-contiguous parts without querying library ownership", async () => {
    const { directory, persistence, service, prepare } = await createHarness();
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
      mode: "selection",
      refs: [
        { rootId: roots[0].id, relativePath: "ABC-123-CD2.mp4" },
        { rootId: parent.id, relativePath: "a/ABC-123-CD2.mp4" },
      ],
      outputRootId: roots[0].id,
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
    "selection",
  ] as const)("admits the requested source, output, metadata roots and manual route (%s)", async (mode) => {
    const { directory, persistence, service, prepare } = await createHarness();
    const source = join(directory, "source");
    const output = join(directory, "output");
    const metadata = join(directory, "metadata");
    for (const path of [source, output, metadata]) await mkdir(path);
    await writeFile(join(source, "ABC-123.mp4"), "video");
    mockConfigManager({
      ...defaultConfiguration,
      behavior: { ...defaultConfiguration.behavior, metadataOnly: true },
      paths: { ...defaultConfiguration.paths, mediaPath: output, metadataPath: metadata },
    });
    const state = await persistence.getState();
    const sourceRoot = await state.repositories.mediaRoots.ensurePath(source);
    const outputRoot = await state.repositories.mediaRoots.ensurePath(output);
    const ref = { rootId: sourceRoot.id, relativePath: "ABC-123.mp4" };
    const manualUrl = "https://www.dmm.co.jp/mono/dvd/-/detail/=/cid=abc00123/";
    const launch = await service.start(
      mode === "single" ? { mode, ref, manualUrl } : { mode, refs: [ref], outputRootId: outputRoot.id },
    );
    await service.waitForIdle();
    const manifest = await state.repositories.scrapeRuns.get(launch.taskId);
    const options = prepare.mock.calls[0][0][0].options;
    expect(manifest.requestedOutputRootId).toBe(mode === "single" ? sourceRoot.id : outputRoot.id);
    expect(options.roots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ hostPath: source }),
        expect.objectContaining({ hostPath: metadata }),
      ]),
    );
    if (mode === "single") {
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
    } else expect(options.roots).toContainEqual(expect.objectContaining({ id: outputRoot.id }));
  });
});

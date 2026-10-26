import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createMediaRoot } from "@mdcz/media-store";
import { FileScraper } from "@mdcz/runtime/scrape";
import { DirectoryInventory } from "@mdcz/runtime/scrape/DirectoryInventory";
import { admitScrapeGroups } from "@mdcz/runtime/scrape/movieGroups";
import { defaultConfiguration } from "@mdcz/shared/config";
import type { MediaLibrarySettingsInput } from "@mdcz/shared/mediaLibrary";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeTestServers, createTempRoot, createTestServer } from "./app.testSupport";

afterEach(async () => {
  vi.restoreAllMocks();
  await closeTestServers();
});

const createHarness = async () => {
  const directory = await createTempRoot("scrape-admission");
  const { services } = await createTestServer();
  const state = await services.persistence.initialize();
  const createLibrary = async (sourcePath: string, overrides: Partial<MediaLibrarySettingsInput> = {}) => {
    await mkdir(sourcePath, { recursive: true });
    return await services.libraries.create({
      name: "Library",
      sourcePath,
      outputPath: join(directory, "library"),
      placement: "move",
      ...overrides,
    });
  };
  // Admission is under test, not scraping: every prepared group fails as if no site had metadata.
  const prepare = vi.spyOn(FileScraper.prototype, "prepareGroup").mockImplementation(async (entries) => ({
    fileId: entries[0]?.filePath ?? "",
    rootId: entries[0]?.options.source?.rootId ?? "local",
    relativePath: entries[0]?.options.source?.relativePath ?? entries[0]?.filePath ?? "",
    fileName: entries[0]?.filePath ?? "",
    status: "failed",
    error: "metadata unavailable",
    assets: [],
  }));
  const finished = async (taskId: string) => {
    await expect
      .poll(async () => (await state.repositories.scrapeRuns.get(taskId)).disposition, { timeout: 10_000 })
      .not.toBeNull();
    return await state.repositories.scrapeRuns.get(taskId);
  };
  return { directory, services, state, prepare, createLibrary, finished };
};

describe("scrape admission and grouping", () => {
  it("packs a directory's parts into one movie and rejects selections that make the parts ambiguous", async () => {
    const { directory, services, state, prepare, createLibrary, finished } = await createHarness();
    const library = await createLibrary(join(directory, "downloads"));
    const source = join(directory, "downloads", "source");
    await mkdir(source);
    for (const name of ["ABC-123-CD1.mp4", "ABC-123-CD2.mp4", "ABC-123-CD1.strm", "trailer.mp4"])
      await writeFile(join(source, name), "content");
    const launch = await services.scrape.start({
      executionMode: "batch",
      libraryId: library.id,
      source: { kind: "directory", scanDir: source, recursive: true },
    });
    const manifest = await finished(launch.task.id);
    expect(manifest.items.map((item) => item.relativePath)).toEqual([
      "source/ABC-123-CD1.mp4",
      "source/ABC-123-CD2.mp4",
    ]);
    expect(prepare).toHaveBeenCalledOnce();
    expect(prepare.mock.calls[0][0]).toHaveLength(2);

    const sourceRoot = await state.repositories.mediaRoots.ensurePath(source);
    for (const name of ["ABC-123.mp4", "ABC-123-part1.mp4"]) await writeFile(join(source, name), "video");
    for (const names of [
      ["ABC-123-CD1.mp4", "ABC-123.mp4"],
      ["ABC-123-CD1.mp4", "ABC-123-part1.mp4"],
    ]) {
      const ambiguous = await services.scrape.start({
        executionMode: "batch",
        libraryId: library.id,
        refs: names.map((relativePath) => ({ rootId: sourceRoot.id, relativePath })),
      });
      expect((await finished(ambiguous.task.id)).disposition).toBe("failed");
      expect(prepare).toHaveBeenCalledOnce();
    }
  });

  it("deduplicates selections and packs only local non-contiguous parts without querying library ownership", async () => {
    const { directory, services, state, prepare, createLibrary, finished } = await createHarness();
    const library = await createLibrary(join(directory, "downloads"));
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
    const launch = await services.scrape.start({
      executionMode: "batch",
      libraryId: library.id,
      refs: [
        { rootId: roots[0].id, relativePath: "ABC-123-CD2.mp4" },
        { rootId: parent.id, relativePath: "a/ABC-123-CD2.mp4" },
      ],
    });
    const manifest = await finished(launch.task.id);
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
    const { directory, services, state, prepare, createLibrary, finished } = await createHarness();
    const source = join(directory, "source");
    const metadata = join(directory, "metadata");
    const library = await createLibrary(source, { placement: "metadataOnly", outputPath: metadata });
    await writeFile(join(source, "ABC-123.mp4"), "video");
    const sourceRoot = await state.repositories.mediaRoots.ensurePath(source);
    const ref = { rootId: sourceRoot.id, relativePath: "ABC-123.mp4" };
    const manualUrl =
      executionMode === "single" ? "https://www.dmm.co.jp/mono/dvd/-/detail/=/cid=abc00123/" : undefined;
    const launch = await services.scrape.start({ executionMode, libraryId: library.id, refs: [ref], manualUrl });
    const manifest = await finished(launch.task.id);
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

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LibraryRepository } from "@mdcz/persistence";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mediaRoots } from "../../../persistence/src/schema";
import { createTestPersistenceDatabase } from "../../../persistence/src/testDatabase";
import { createMemoryPublicationJournal } from "./memoryJournal";
import { commitRegisteredPublication } from "./registered";

const databases: ReturnType<typeof createTestPersistenceDatabase>[] = [];
const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    directories.splice(0).map(async (directory) => await rm(directory, { recursive: true, force: true })),
  );
});

describe("commitRegisteredPublication", () => {
  it.each([
    "movie",
    "unmanaged",
  ] as const)("writes without a journal and respects the %s asset scope", async (owner) => {
    const directory = await mkdtemp(path.join(tmpdir(), "mdcz-registered-"));
    directories.push(directory);
    const nfoPath = path.join(directory, "movie.nfo");
    await writeFile(nfoPath, "original");
    const journal = createMemoryPublicationJournal();
    const roots = [{ id: "library", hostPath: directory }];
    const database = createTestPersistenceDatabase();
    databases.push(database);
    database.db
      .insert(mediaRoots)
      .values({
        id: "library",
        displayName: "Library",
        hostPath: directory,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    const library = new LibraryRepository(database);
    const strm = { kind: "strm", uri: "movie.strm", rootId: "library", relativePath: "movie.strm", published: true };
    await library.upsertEntry({
      movie: {
        id: "movie",
        title: "Original",
        number: "ABC-123",
        assets: [
          { kind: "nfo", uri: "movie.nfo", rootId: "library", relativePath: "movie.nfo", published: true },
          { kind: "trailer", uri: "https://example.test/trailer.mp4" },
        ],
      },
      files: [{ fileId: "file", rootId: "library", rootRelativePath: "movie.mp4", size: 42, assets: [strm] }],
    });
    const snapshot = vi.spyOn(library, "publicationSnapshot");
    const begin = vi.spyOn(journal, "begin");

    const publication = commitRegisteredPublication(
      {
        operationId: "nfo-write:movie",
        operationType: "maintenance",
        operations: [
          {
            kind: "write",
            owner,
            assetKind: "nfo",
            targetPath: nfoPath,
            content: { kind: "text", data: "updated" },
            replaceExisting: true,
          },
        ],
      },
      { journal, roots, outputs: library, library },
    );

    if (owner === "unmanaged") {
      await expect(publication).rejects.toThrow("已被其他影片占用");
      expect(await readFile(nfoPath, "utf8")).toBe("original");
      expect(journal.listUnfinished()).toEqual([]);
      expect((await library.getEntryById("movie")).assets.map((asset) => asset.kind).sort()).toEqual([
        "nfo",
        "strm",
        "trailer",
      ]);
      return;
    }
    await publication;
    expect(begin).not.toHaveBeenCalled();
    const entry = await library.getEntryById("movie");
    expect(entry).toMatchObject({
      title: "Original",
      number: "ABC-123",
      files: [expect.objectContaining({ id: "file", size: 42 })],
    });
    expect(entry.assets.map((asset) => asset.kind).sort()).toEqual(["nfo", "strm", "trailer"]);
    expect(snapshot.mock.calls.every(([query]) => query.paths !== undefined)).toBe(true);
    await expect(readFile(nfoPath, "utf8")).resolves.toBe("updated");
    await commitRegisteredPublication(
      {
        operationId: "nfo-write:repeat",
        operationType: "maintenance",
        operations: [
          {
            kind: "write",
            owner,
            assetKind: "nfo",
            targetPath: nfoPath,
            content: { kind: "text", data: "updated again" },
            replaceExisting: true,
          },
        ],
      },
      { journal, roots, outputs: library, library },
    );
    expect(begin).not.toHaveBeenCalled();
    expect(await readFile(nfoPath, "utf8")).toBe("updated again");
    expect(await readdir(directory)).toEqual(["movie.nfo"]);
  });

  it.each(["outside", "protected-source"])("rejects unsafe unmanaged tool targets: %s", async (scenario) => {
    const directory = await mkdtemp(path.join(tmpdir(), "mdcz-registered-"));
    directories.push(directory);
    const outsideDir = await mkdtemp(path.join(tmpdir(), "mdcz-outside-"));
    directories.push(outsideDir);
    const outside = path.join(scenario === "protected-source" ? directory : outsideDir, "movie.nfo");
    if (scenario === "protected-source") await writeFile(outside, "original");
    await mkdir(path.dirname(outside), { recursive: true });
    await expect(
      commitRegisteredPublication(
        {
          operationId: "nfo-write:outside",
          operationType: "maintenance",
          mediaPaths: scenario === "protected-source" ? [outside] : undefined,
          operations: [
            {
              kind: "write",
              owner: "unmanaged",
              targetPath: outside,
              content: { kind: "text", data: "updated" },
              replaceExisting: false,
            },
          ],
        },
        { journal: createMemoryPublicationJournal(), roots: [{ id: "library", hostPath: directory }] },
      ),
    ).rejects.toThrow(scenario === "protected-source" ? "受保护的原始文件" : "outside registered roots");
    if (scenario === "protected-source") expect(await readFile(outside, "utf8")).toBe("original");
  });
});

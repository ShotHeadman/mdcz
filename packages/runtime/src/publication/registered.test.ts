import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryPublicationJournal } from "./memoryJournal";
import { recoverPublications } from "./recoverPublications";
import { commitRegisteredPublication } from "./registered";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (directory) => await rm(directory, { recursive: true, force: true })),
  );
});

describe("commitRegisteredPublication", () => {
  it("journals registered root IDs that startup recovery can resolve", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mdcz-registered-"));
    directories.push(directory);
    const nfoPath = path.join(directory, "movie.nfo");
    await writeFile(nfoPath, "original");
    const journal = createMemoryPublicationJournal();
    const roots = [{ id: "library", hostPath: directory }];
    let begunRootId: string | undefined;
    const originalBegin = journal.begin.bind(journal);
    journal.begin = (entry) => {
      begunRootId = entry.manifest.entries[0]?.rootId;
      originalBegin(entry);
    };

    await commitRegisteredPublication(
      {
        operationId: "nfo-write:movie",
        operationType: "maintenance",
        artifacts: [{ targetPath: nfoPath, content: { kind: "text", data: "updated" } }],
        replaceExistingArtifacts: true,
      },
      { journal, roots },
    );

    expect(begunRootId).toBe("library");
    await expect(readFile(nfoPath, "utf8")).resolves.toBe("updated");

    const backup = path.join(directory, "movie.nfo.nfo-write_movie.bak");
    const temporary = path.join(directory, "movie.nfo.nfo-write_movie.part");
    await writeFile(nfoPath, "updated");
    await writeFile(backup, "original");
    await writeFile(temporary, "partial");
    journal.begin({
      operationId: "nfo-write:crash",
      operationType: "maintenance",
      createdAt: new Date(),
      manifest: {
        entries: [
          {
            rootId: "library",
            relativePath: "movie.nfo",
            temporaryPath: "movie.nfo.nfo-write_movie.part",
            backupPath: "movie.nfo.nfo-write_movie.bak",
            targetExisted: true,
          },
        ],
        obsolete: [],
      },
    });

    await recoverPublications({
      journal,
      resolveRoot: async (rootId) => {
        const root = roots.find((candidate) => candidate.id === rootId);
        if (!root) throw new Error(`missing root ${rootId}`);
        return root;
      },
    });
    expect(journal.listUnfinished()).toEqual([]);
    await expect(readFile(nfoPath, "utf8")).resolves.toBe("original");
  });

  it("rejects paths outside registered roots", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mdcz-registered-"));
    directories.push(directory);
    const outsideDir = await mkdtemp(path.join(tmpdir(), "mdcz-outside-"));
    directories.push(outsideDir);
    const outside = path.join(outsideDir, "movie.nfo");
    await mkdir(path.dirname(outside), { recursive: true });
    await expect(
      commitRegisteredPublication(
        {
          operationId: "nfo-write:outside",
          operationType: "maintenance",
          artifacts: [{ targetPath: outside, content: { kind: "text", data: "updated" } }],
        },
        { journal: createMemoryPublicationJournal(), roots: [{ id: "library", hostPath: directory }] },
      ),
    ).rejects.toThrow("outside registered roots");
  });
});

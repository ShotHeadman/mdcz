import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryPublicationJournal } from "./memoryJournal";
import { recoverPublications } from "./recoverPublications";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("move recovery", () => {
  it.each(["source", "staged", "target", "rewritten"])("returns pending original bytes from %s", async (location) => {
    const directory = await mkdtemp(path.join(tmpdir(), "mdcz-recovery-"));
    directories.push(directory);
    await writeFile(
      path.join(directory, location === "source" ? "source.mp4" : location === "target" ? "target.mp4" : "target.part"),
      "original",
    );
    if (location === "rewritten") await writeFile(path.join(directory, "target.mp4"), "rewritten");
    const journal = createMemoryPublicationJournal();
    journal.begin({
      operationId: "move",
      operationType: "scrape",
      createdAt: new Date(),
      manifest: {
        entries: [
          {
            rootId: "root",
            relativePath: "target.mp4",
            temporaryPath: "target.part",
            source: { rootId: "root", relativePath: "source.mp4" },
            ...(location === "rewritten" ? { rewritten: true } : {}),
          },
        ],
      },
    });
    const options = { journal, resolveRoot: async () => ({ id: "root", hostPath: directory }) };
    await recoverPublications(options);
    await recoverPublications(options);
    expect(await readFile(path.join(directory, "source.mp4"), "utf8")).toBe("original");
    expect(await readdir(directory)).toEqual(["source.mp4"]);
    expect(journal.listUnfinished()).toEqual([]);
  });

  it.each(["target", "staged"])("finishes committed moves from %s", async (location) => {
    const directory = await mkdtemp(path.join(tmpdir(), "mdcz-recovery-"));
    directories.push(directory);
    await writeFile(path.join(directory, location === "target" ? "target.mp4" : "target.part"), "original");
    const journal = createMemoryPublicationJournal();
    journal.begin({
      operationId: "move",
      operationType: "scrape",
      createdAt: new Date(),
      manifest: {
        entries: [
          {
            rootId: "root",
            relativePath: "target.mp4",
            temporaryPath: "target.part",
            source: { rootId: "root", relativePath: "source.mp4" },
          },
        ],
      },
    });
    journal.commit("move", () => undefined);
    await recoverPublications({ journal, resolveRoot: async () => ({ id: "root", hostPath: directory }) });
    expect(await readFile(path.join(directory, "target.mp4"), "utf8")).toBe("original");
    expect(await readdir(directory)).toEqual(["target.mp4"]);
    expect(journal.listUnfinished()).toEqual([]);
  });

  it.each([
    "conflict",
    "missing",
    "unavailable",
  ])("retains unsafe moves and reports repair needs: %s", async (scenario) => {
    const directory = await mkdtemp(path.join(tmpdir(), "mdcz-recovery-"));
    directories.push(directory);
    if (scenario === "conflict") {
      await writeFile(path.join(directory, "source.mp4"), "original");
      await writeFile(path.join(directory, "target.mp4"), "foreign");
    }
    const journal = createMemoryPublicationJournal();
    journal.begin({
      operationId: "move",
      operationType: "scrape",
      createdAt: new Date(),
      manifest: {
        entries: [
          {
            rootId: "root",
            relativePath: "target.mp4",
            temporaryPath: "target.part",
            source: { rootId: "root", relativePath: "source.mp4" },
          },
        ],
      },
    });
    const repairIssues = { record: vi.fn(), resolve: vi.fn() };
    await recoverPublications({
      journal,
      repairIssues,
      resolveRoot: async () => {
        if (scenario === "unavailable") throw new Error("root unavailable");
        return { id: "root", hostPath: directory };
      },
    });
    expect(journal.listUnfinished()).toHaveLength(1);
    expect(repairIssues.record).toHaveBeenCalledOnce();
    if (scenario === "conflict") {
      expect(await readFile(path.join(directory, "source.mp4"), "utf8")).toBe("original");
      expect(await readFile(path.join(directory, "target.mp4"), "utf8")).toBe("foreign");
    }
  });
});

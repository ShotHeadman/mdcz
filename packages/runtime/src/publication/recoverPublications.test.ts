import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryPublicationJournal } from "./memoryJournal";
import { commitPublishedMedia } from "./publishMedia";
import { recoverPublications } from "./recoverPublications";
import type { PublicationJournalManifest, PublicationPlan } from "./types";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (directory) => await rm(directory, { recursive: true, force: true })),
  );
});

const token = (operationId: string): string => operationId.replaceAll(/[^A-Za-z0-9._-]/g, "_");

const sibling = (targetPath: string, operationId: string, suffix: "part" | "bak"): string => {
  const parsed = path.parse(targetPath);
  return path.join(parsed.dir, `${parsed.base}.${token(operationId)}.${suffix}`);
};

const residue = async (root: string): Promise<string[]> => {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && (entry.name.endsWith(".part") || entry.name.endsWith(".bak")))
    .map((entry) => entry.name);
};

describe("recoverPublications", () => {
  it("rolls back a pending row that has both backup and new target on disk", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mdcz-recover-"));
    directories.push(directory);
    const target = path.join(directory, "movie.nfo");
    const backup = sibling(target, "op-1", "bak");
    const temporary = sibling(target, "op-1", "part");
    await writeFile(target, "new-nfo");
    await writeFile(backup, "original-nfo");
    await writeFile(temporary, "partial");
    const journal = createMemoryPublicationJournal();
    const manifest: PublicationJournalManifest = {
      entries: [
        {
          rootId: "root-1",
          relativePath: "movie.nfo",
          temporaryPath: temporary,
          backupPath: backup,
          targetExisted: true,
        },
      ],
      obsolete: [],
    };
    journal.begin({ operationId: "op-1", operationType: "scrape", manifest, createdAt: new Date() });

    await recoverPublications({
      journal,
      resolveRoot: async () => ({ id: "root-1", hostPath: directory }),
    });

    await expect(readFile(target, "utf8")).resolves.toBe("original-nfo");
    await expect(stat(backup)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(temporary)).rejects.toMatchObject({ code: "ENOENT" });
    expect(journal.listUnfinished()).toEqual([]);
  });

  it("rolls forward a committed row by removing backups and obsolete sources", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mdcz-recover-"));
    directories.push(directory);
    const target = path.join(directory, "movie.mp4");
    const backup = sibling(target, "op-1", "bak");
    const obsolete = path.join(directory, "old.jpg");
    await writeFile(target, "new-video");
    await writeFile(backup, "old-video");
    await writeFile(obsolete, "old");
    const journal = createMemoryPublicationJournal();
    journal.begin({
      operationId: "op-1",
      operationType: "scrape",
      manifest: {
        entries: [
          {
            rootId: "root-1",
            relativePath: "movie.mp4",
            temporaryPath: sibling(target, "op-1", "part"),
            backupPath: backup,
            targetExisted: true,
          },
        ],
        obsolete: [{ rootId: "root-1", relativePath: "old.jpg" }],
      } satisfies PublicationJournalManifest,
      createdAt: new Date(),
    });
    journal.commit("op-1", () => undefined);

    await recoverPublications({
      journal,
      resolveRoot: async () => ({ id: "root-1", hostPath: directory }),
    });

    await expect(readFile(target, "utf8")).resolves.toBe("new-video");
    await expect(stat(backup)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(obsolete)).rejects.toMatchObject({ code: "ENOENT" });
    expect(journal.listUnfinished()).toEqual([]);
    await expect(residue(directory)).resolves.toEqual([]);
  });

  it("retains the row when the root is unresolvable and rejects a later conflicting publication", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mdcz-recover-"));
    directories.push(directory);
    const target = path.join(directory, "movie.nfo");
    const backup = sibling(target, "op-1", "bak");
    await writeFile(target, "new-nfo");
    await writeFile(backup, "original-nfo");
    const journal = createMemoryPublicationJournal();
    journal.begin({
      operationId: "op-1",
      operationType: "maintenance",
      manifest: {
        entries: [
          {
            rootId: "root-1",
            relativePath: "movie.nfo",
            temporaryPath: sibling(target, "op-1", "part"),
            backupPath: backup,
            targetExisted: true,
          },
        ],
        obsolete: [],
      } satisfies PublicationJournalManifest,
      createdAt: new Date(),
    });

    await recoverPublications({
      journal,
      resolveRoot: async () => {
        throw new Error("root missing");
      },
    });

    expect(journal.listUnfinished()).toHaveLength(1);
    await expect(readFile(target, "utf8")).resolves.toBe("new-nfo");
    await expect(readFile(backup, "utf8")).resolves.toBe("original-nfo");

    const plan: PublicationPlan = {
      operationId: "op-2",
      operationType: "maintenance",
      artifacts: [
        { target: { rootId: "root-1", relativePath: "movie.nfo" }, content: { kind: "text", data: "other" } },
      ],
      assets: [],
      obsolete: [],
      replaceExistingTargets: [{ rootId: "root-1", relativePath: "movie.nfo" }],
    };
    await expect(
      commitPublishedMedia(plan, {
        resolveRoot: async () => ({ id: "root-1", hostPath: directory }),
        journal,
        commit: () => undefined,
      }),
    ).rejects.toThrow("unfinished operation");
    await expect(readFile(target, "utf8")).resolves.toBe("new-nfo");
  });

  it("records a repair issue for a manifest/disk mismatch and still completes", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mdcz-recover-"));
    directories.push(directory);
    const journal = createMemoryPublicationJournal();
    journal.begin({
      operationId: "op-1",
      operationType: "scrape",
      manifest: {
        entries: [
          {
            rootId: "root-1",
            relativePath: "movie.nfo",
            temporaryPath: path.join(directory, "movie.nfo.op-1.part"),
            backupPath: path.join(directory, "movie.nfo.op-1.bak"),
            targetExisted: true,
          },
        ],
        obsolete: [],
      } satisfies PublicationJournalManifest,
      createdAt: new Date(),
    });
    const repairIssues = { record: vi.fn(() => undefined), resolve: vi.fn(() => undefined) };

    await expect(
      recoverPublications({
        journal,
        repairIssues,
        resolveRoot: async () => ({ id: "root-1", hostPath: directory }),
      }),
    ).resolves.toBeUndefined();

    expect(repairIssues.record).toHaveBeenCalledOnce();
    expect(journal.listUnfinished()).toHaveLength(1);
  });
});

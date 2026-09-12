import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adaptPublicationJournal } from "./journalAdapter";
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

const siblingRelative = (relativePath: string, operationId: string, suffix: "part" | "bak"): string =>
  `${relativePath}.${token(operationId)}.${suffix}`;

const residue = async (root: string): Promise<string[]> => {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && (entry.name.endsWith(".part") || entry.name.endsWith(".bak")))
    .map((entry) => entry.name);
};

describe("recoverPublications", () => {
  it.each([
    ["staged", false],
    ["published", false],
    ["backed-up", true],
    ["published", true],
    ["unpublished-target", false],
  ] as const)("restores moved video and subtitles after a crash at %s (replacing=%s)", async (phase, replacing) => {
    const directory = await mkdtemp(path.join(tmpdir(), "mdcz-recover-moves-"));
    directories.push(directory);
    const journal = createMemoryPublicationJournal();
    const manifest: PublicationJournalManifest = { entries: [], obsolete: [] };
    for (const extension of ["mp4", "zh.srt"]) {
      const source = `source.${extension}`;
      const target = `target.${extension}`;
      const temporary = `${target}.part`;
      const backup = `${target}.bak`;
      await writeFile(path.join(directory, phase === "published" ? target : temporary), `original-${extension}`);
      if (replacing) await writeFile(path.join(directory, backup), `previous-${extension}`);
      const { size, mtimeMs, ino, dev } = await stat(path.join(directory, phase === "published" ? target : temporary));
      if (phase === "unpublished-target") await writeFile(path.join(directory, target), `foreign-${extension}`);
      manifest.entries.push({
        staged: phase === "unpublished-target" ? undefined : { size, mtimeMs, ino, dev },
        rootId: "root",
        relativePath: target,
        temporaryPath: temporary,
        backupPath: replacing ? backup : null,
        targetExisted: replacing,
        source: { rootId: "root", relativePath: source },
      });
    }
    journal.begin({ operationId: "crashed-move", operationType: "scrape", manifest, createdAt: new Date() });
    const options = { journal, resolveRoot: async () => ({ id: "root", hostPath: directory }) };
    await recoverPublications(options);
    await recoverPublications(options);
    for (const extension of ["mp4", "zh.srt"]) {
      await expect(readFile(path.join(directory, `source.${extension}`), "utf8")).resolves.toBe(
        `original-${extension}`,
      );
      if (replacing) {
        await expect(readFile(path.join(directory, `target.${extension}`), "utf8")).resolves.toBe(
          `previous-${extension}`,
        );
      } else if (phase === "unpublished-target") {
        await expect(readFile(path.join(directory, `target.${extension}`), "utf8")).resolves.toBe(
          `foreign-${extension}`,
        );
      } else {
        await expect(stat(path.join(directory, `target.${extension}`))).rejects.toMatchObject({ code: "ENOENT" });
      }
    }
    expect(journal.listUnfinished()).toHaveLength(phase === "unpublished-target" ? 1 : 0);
    if (phase !== "unpublished-target") await expect(residue(directory)).resolves.toEqual([]);
  });
  it("rolls back a pending row that has both backup and new target on disk", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mdcz-recover-"));
    directories.push(directory);
    const target = path.join(directory, "movie.nfo");
    const backup = path.join(directory, siblingRelative("movie.nfo", "op-1", "bak"));
    const temporary = path.join(directory, siblingRelative("movie.nfo", "op-1", "part"));
    await writeFile(target, "new-nfo");
    await writeFile(backup, "original-nfo");
    await writeFile(temporary, "partial");
    const journal = createMemoryPublicationJournal();
    const repairIssues = { record: vi.fn(() => undefined), resolve: vi.fn(() => undefined) };
    const { size, mtimeMs, ino, dev } = await stat(target);
    const manifest: PublicationJournalManifest = {
      entries: [
        {
          staged: { size, mtimeMs, ino, dev },
          rootId: "root-1",
          relativePath: "movie.nfo",
          temporaryPath: siblingRelative("movie.nfo", "op-1", "part"),
          backupPath: siblingRelative("movie.nfo", "op-1", "bak"),
          targetExisted: true,
        },
      ],
      obsolete: [],
    };
    journal.begin({ operationId: "op-1", operationType: "scrape", manifest, createdAt: new Date() });

    await recoverPublications({
      journal,
      repairIssues,
      resolveRoot: async () => ({ id: "root-1", hostPath: directory }),
    });

    await expect(readFile(target, "utf8")).resolves.toBe("original-nfo");
    await expect(stat(backup)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(temporary)).rejects.toMatchObject({ code: "ENOENT" });
    expect(journal.listUnfinished()).toEqual([]);
    expect(repairIssues.resolve).toHaveBeenCalledWith("op-1", "root-1", "movie.nfo");
  });

  it("rolls forward a committed row by removing backups and obsolete sources", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mdcz-recover-"));
    directories.push(directory);
    const target = path.join(directory, "movie.mp4");
    const backup = path.join(directory, siblingRelative("movie.mp4", "op-1", "bak"));
    const obsolete = path.join(directory, "old.jpg");
    await writeFile(target, "new-video");
    await writeFile(backup, "old-video");
    await writeFile(obsolete, "old");
    const obsoleteInfo = await stat(obsolete);
    const journal = createMemoryPublicationJournal();
    journal.begin({
      operationId: "op-1",
      operationType: "scrape",
      manifest: {
        entries: [
          {
            rootId: "root-1",
            relativePath: "movie.mp4",
            temporaryPath: siblingRelative("movie.mp4", "op-1", "part"),
            backupPath: siblingRelative("movie.mp4", "op-1", "bak"),
            targetExisted: true,
          },
        ],
        obsolete: [
          {
            rootId: "root-1",
            relativePath: "old.jpg",
            observed: {
              exists: true,
              size: obsoleteInfo.size,
              mtimeMs: obsoleteInfo.mtimeMs,
              isFile: obsoleteInfo.isFile(),
            },
          },
        ],
      } satisfies PublicationJournalManifest,
      createdAt: new Date(),
    });
    journal.commit("op-1", () => undefined);
    const repairIssues = { record: vi.fn(() => undefined), resolve: vi.fn(() => undefined) };

    await recoverPublications({
      journal,
      repairIssues,
      resolveRoot: async () => ({ id: "root-1", hostPath: directory }),
    });

    await expect(readFile(target, "utf8")).resolves.toBe("new-video");
    await expect(stat(backup)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(obsolete)).rejects.toMatchObject({ code: "ENOENT" });
    expect(journal.listUnfinished()).toEqual([]);
    await expect(residue(directory)).resolves.toEqual([]);
    expect(repairIssues.resolve).toHaveBeenCalledWith("op-1", "root-1", "movie.mp4");
    expect(repairIssues.resolve).toHaveBeenCalledWith("op-1", "root-1", "old.jpg");
  });

  it("retains the row when the root is unresolvable and rejects a later conflicting publication", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mdcz-recover-"));
    directories.push(directory);
    const target = path.join(directory, "movie.nfo");
    const backup = path.join(directory, siblingRelative("movie.nfo", "op-1", "bak"));
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
            temporaryPath: siblingRelative("movie.nfo", "op-1", "part"),
            backupPath: siblingRelative("movie.nfo", "op-1", "bak"),
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
    ).rejects.toThrow("未完成的发布操作");
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
            temporaryPath: siblingRelative("movie.nfo", "op-1", "part"),
            backupPath: siblingRelative("movie.nfo", "op-1", "bak"),
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

  it("retains a changed obsolete file on committed recovery and still finishes the row", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mdcz-recover-"));
    directories.push(directory);
    const target = path.join(directory, "movie.mp4");
    const backup = path.join(directory, siblingRelative("movie.mp4", "op-1", "bak"));
    const obsolete = path.join(directory, "old.jpg");
    await writeFile(target, "new-video");
    await writeFile(backup, "old-video");
    await writeFile(obsolete, "old");
    const obsoleteInfo = await stat(obsolete);
    await writeFile(obsolete, "foreign obsolete");
    const journal = createMemoryPublicationJournal();
    journal.begin({
      operationId: "op-1",
      operationType: "scrape",
      manifest: {
        entries: [
          {
            rootId: "root-1",
            relativePath: "movie.mp4",
            temporaryPath: siblingRelative("movie.mp4", "op-1", "part"),
            backupPath: siblingRelative("movie.mp4", "op-1", "bak"),
            targetExisted: true,
          },
        ],
        obsolete: [
          {
            rootId: "root-1",
            relativePath: "old.jpg",
            observed: {
              exists: true,
              size: obsoleteInfo.size,
              mtimeMs: obsoleteInfo.mtimeMs,
              isFile: obsoleteInfo.isFile(),
            },
          },
        ],
      } satisfies PublicationJournalManifest,
      createdAt: new Date(),
    });
    journal.commit("op-1", () => undefined);
    const repairIssues = { record: vi.fn(() => undefined), resolve: vi.fn(() => undefined) };

    await recoverPublications({
      journal,
      repairIssues,
      resolveRoot: async () => ({ id: "root-1", hostPath: directory }),
    });

    await expect(readFile(obsolete, "utf8")).resolves.toBe("foreign obsolete");
    await expect(stat(backup)).rejects.toMatchObject({ code: "ENOENT" });
    expect(journal.listUnfinished()).toEqual([]);
    expect(repairIssues.record).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: "op-1",
        rootId: "root-1",
        relativePath: "old.jpg",
      }),
    );
    expect(repairIssues.resolve).toHaveBeenCalledWith("op-1", "root-1", "movie.mp4");
    expect(repairIssues.resolve).not.toHaveBeenCalledWith("op-1", "root-1", "old.jpg");
  });

  it.each([
    { not: "a manifest" },
    {
      entries: [
        {
          rootId: "root-1",
          relativePath: "../outside.nfo",
          temporaryPath: "movie.nfo.part",
          backupPath: null,
          targetExisted: false,
        },
      ],
      obsolete: [],
    },
  ])("records a repair issue for a malformed stored manifest %#", async (manifest) => {
    const journal = adaptPublicationJournal({
      begin() {},
      stage() {},
      commit(_operationId, write) {
        return write();
      },
      finish() {},
      listUnfinished: () => [
        {
          operationId: "op-bad",
          operationType: "scrape",
          state: "pending",
          manifest,
          createdAt: new Date(),
        },
      ],
    });
    const repairIssues = { record: vi.fn(() => undefined), resolve: vi.fn(() => undefined) };

    await recoverPublications({
      journal,
      repairIssues,
      resolveRoot: async () => ({ id: "root-1", hostPath: "/tmp" }),
    });

    expect(repairIssues.record).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: "op-bad",
        errorMessage: "Publication journal manifest is invalid",
      }),
    );
    expect(journal.listUnfinished()).toEqual([]);
  });
});

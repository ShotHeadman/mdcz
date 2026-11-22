import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { PARKED_SOURCE_PREFIX } from "./MoveOutput";
import { outputFileSystem } from "./outputFileSystem";
import { type PublicationJournalEntry, publicationJournal } from "./publicationJournal";
import { recoverInterruptedPublications } from "./recoverInterruptedPublications";
import { WriteOutput } from "./WriteOutput";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const createStore = () => {
  const entries = new Map<string, PublicationJournalEntry>();
  return {
    entries,
    record: (entry: PublicationJournalEntry) => void entries.set(entry.path, entry),
    forget: (entryPath: string) => void entries.delete(entryPath),
    list: () => [...entries.values()],
  };
};

it("journals temporary paths and recovers only those: staging removed, parked sources restored, nothing overwritten", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mdcz-recover-"));
  directories.push(root);
  const movie = path.join(root, "ABC-123");
  await mkdir(movie, { recursive: true });
  const store = createStore();
  publicationJournal.attach(store);

  // A publication whose staging cleanup fails keeps the record, so the leftover is removed on the next start.
  const failingRm = vi.fn(async () => {
    throw Object.assign(new Error("busy"), { code: "EBUSY" });
  });
  await new WriteOutput({ ...outputFileSystem, rm: failingRm }, { warn: vi.fn() }).install(
    [{ targetPath: path.join(movie, "movie.nfo"), data: "<movie/>" }],
    { commit: () => undefined },
  );
  expect(store.entries.size).toBe(0);
  await expect(
    new WriteOutput({ ...outputFileSystem, rm: failingRm }, { warn: vi.fn() }).install(
      [{ targetPath: path.join(movie, "poster.jpg"), data: "poster" }],
      {
        validate: () => {
          throw new Error("validation failed");
        },
        commit: () => undefined,
      },
    ),
  ).rejects.toThrow("validation failed");
  const [leftover] = store.list();
  expect(leftover?.path).toContain(".mdcz-staging-");
  expect(existsSync(leftover?.path ?? "")).toBe(true);

  const stagingDirectory = path.join(movie, `.mdcz-staging-${randomUUID()}`);
  publicationJournal.record(stagingDirectory);
  await mkdir(stagingDirectory);
  await writeFile(path.join(stagingDirectory, "thumb.jpg"), "thumb");
  const parked = path.join(movie, `${PARKED_SOURCE_PREFIX}${randomUUID()}-ABC-123-cd1.mp4`);
  publicationJournal.record(parked, path.join(movie, "ABC-123-cd1.mp4"));
  await writeFile(parked, "cd1");
  const blockedName = "ABC-123.mdcz-backup-cd2.mp4";
  const blocked = path.join(movie, `${PARKED_SOURCE_PREFIX}${randomUUID()}-${blockedName}`);
  publicationJournal.record(blocked, path.join(movie, blockedName));
  await writeFile(blocked, "parked cd2");
  await writeFile(path.join(movie, blockedName), "current cd2");
  // A direct write interrupted mid-file: the backup entry alone removes the truncated target and restores the original.
  const truncated = path.join(movie, "fanart.jpg");
  const replaced = `${truncated}.mdcz-backup-${randomUUID()}`;
  publicationJournal.record(replaced, truncated);
  await writeFile(replaced, "original fanart");
  await writeFile(truncated, "fan");
  // If rollback already renamed the backup back before exit, recovery must keep the restored original intact.
  const restored = path.join(movie, "banner.jpg");
  publicationJournal.record(`${restored}.mdcz-backup-${randomUUID()}`, restored);
  await writeFile(restored, "original banner");
  const offline = path.join(root, "offline-mount", ".mdcz-staging-offline");
  publicationJournal.record(offline);
  const logger = { warn: vi.fn() };

  await recoverInterruptedPublications(store, logger);

  expect(existsSync(leftover?.path ?? "")).toBe(false);
  expect(existsSync(stagingDirectory)).toBe(false);
  await expect(readFile(path.join(movie, "ABC-123-cd1.mp4"), "utf8")).resolves.toBe("cd1");
  await expect(readFile(path.join(movie, blockedName), "utf8")).resolves.toBe("current cd2");
  await expect(readFile(blocked, "utf8")).resolves.toBe("parked cd2");
  await expect(readFile(truncated, "utf8")).resolves.toBe("original fanart");
  expect(existsSync(replaced)).toBe(false);
  await expect(readFile(restored, "utf8")).resolves.toBe("original banner");
  expect(logger.warn).toHaveBeenCalledOnce();
  expect(logger.warn.mock.calls[0]?.[0]).toContain(blocked);
  expect(store.list().map((entry) => entry.path)).toEqual([blocked, offline]);
});

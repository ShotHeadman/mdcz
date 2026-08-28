import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DesktopPersistenceService } from "@main/services/persistence";
import { createMediaRoot } from "@mdcz/media-store";
import { afterEach, describe, expect, it } from "vitest";
import { createTempDirectory, type TempDirectoryHarness } from "../../../harness/tempDirectory";

const directories: TempDirectoryHarness[] = [];
const services: DesktopPersistenceService[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map(async (service) => await service.close()));
  await Promise.all(directories.splice(0).map(async (directory) => await directory.cleanup()));
});

const createService = async () => {
  const directory = await createTempDirectory("desktop-persistence");
  directories.push(directory);
  const service = new DesktopPersistenceService(join(directory.path, "data", "mdcz.sqlite"), null);
  services.push(service);
  return { directory, service };
};

describe("DesktopPersistenceService", () => {
  it("joins concurrent initialize and getState onto a single recovery", async () => {
    const { service } = await createService();

    const [first, second, third] = await Promise.all([service.initialize(), service.initialize(), service.getState()]);

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(service.initialized).toBe(true);
  });

  it("recovers a pending publication when initialize runs", async () => {
    const { directory, service } = await createService();
    const mediaRoot = join(directory.path, "media");
    await mkdir(mediaRoot, { recursive: true });
    const target = join(mediaRoot, "movie.nfo");
    const backup = join(mediaRoot, "movie.nfo.op.bak");
    await writeFile(target, "published");
    await writeFile(backup, "original");

    const state = await service.initialize();
    await state.repositories.mediaRoots.upsert(
      createMediaRoot({ id: "root-1", displayName: "Media", hostPath: mediaRoot }),
    );
    state.repositories.publicationJournal.begin({
      operationId: "op-1",
      operationType: "scrape",
      createdAt: new Date(),
      manifest: {
        entries: [
          {
            rootId: "root-1",
            relativePath: "movie.nfo",
            temporaryPath: join(mediaRoot, "movie.nfo.op.part"),
            backupPath: backup,
            targetExisted: true,
          },
        ],
        obsolete: [],
      },
    });
    await service.close();

    const restarted = new DesktopPersistenceService(join(directory.path, "data", "mdcz.sqlite"), null);
    services.push(restarted);
    await restarted.initialize();

    expect((await restarted.getState()).repositories.publicationJournal.listUnfinished()).toEqual([]);
    await expect(readFile(target, "utf8")).resolves.toBe("original");
  });
});

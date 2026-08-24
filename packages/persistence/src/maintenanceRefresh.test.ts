import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createMediaRoot } from "@mdcz/media-store";
import { afterEach, describe, expect, it } from "vitest";
import { createTempDirectory } from "../../../tests/harness/tempDirectory";
import type { PersistenceDatabase } from "./database";
import { LibraryRepository } from "./libraryRepository";
import { MediaRootRepository } from "./mediaRootRepository";
import { libraryItemFiles } from "./schema";
import { createTestPersistenceDatabase } from "./testDatabase";

const databases: PersistenceDatabase[] = [];
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const crawlerData = (number: string) => ({
  title: `Title ${number}`,
  number,
  actors: ["Actor"],
  genres: [],
  scene_images: [],
  thumb_url: "https://example.com/remote-thumb.jpg",
});

const createFixture = async () => {
  const directory = await createTempDirectory("maintenance-library-refresh");
  cleanups.push(directory.cleanup);
  const database = createTestPersistenceDatabase();
  databases.push(database);
  const roots = new MediaRootRepository(database);
  const library = new LibraryRepository(database);
  const root = createMediaRoot({ id: "root-main", displayName: "Main", hostPath: directory.path });
  await roots.upsert(root);
  return { database, directory, library, root, roots };
};

describe("LibraryRepository maintenance refresh", () => {
  it("keeps a stable primary file id relocatable while enforcing unique library paths", async () => {
    const { library, root } = await createFixture();
    await library.upsertEntry({ id: "stable", rootId: root.id, rootRelativePath: "old.mp4" });
    await library.upsertEntry({ id: "stable", rootId: root.id, rootRelativePath: "new.mp4" });

    expect(await library.getEntryById("stable")).toMatchObject({
      id: "stable",
      rootRelativePath: "new.mp4",
    });
    await expect(library.getEntry(root.id, "old.mp4")).rejects.toThrow("Library entry not found");
  });

  it("updates the original item identity and file ref while preserving creation provenance and unrelated refs", async () => {
    const { database, directory, library, root } = await createFixture();
    const sourcePath = path.join(directory.path, "old.mp4");
    const targetPath = path.join(directory.path, "renamed.mp4");
    const posterPath = path.join(directory.path, "images", "poster.jpg");
    const actorPhotoPath = path.join(directory.path, ".actors", "Actor.jpg");
    await writeFile(sourcePath, "video");
    await mkdir(path.dirname(posterPath), { recursive: true });
    await mkdir(path.dirname(actorPhotoPath), { recursive: true });
    await writeFile(posterPath, "poster");
    await writeFile(actorPhotoPath, "actor");
    const createdAt = new Date("2026-01-02T03:04:05.000Z");
    const original = await library.upsertEntry({
      id: "stable-library-id",
      rootId: root.id,
      rootRelativePath: "old.mp4",
      sourceRunId: "scrape-task",
      sourceOutcomeId: "scrape-output",
      createdAt,
      crawlerDataJson: JSON.stringify(crawlerData("OLD-001")),
    });
    database.db
      .insert(libraryItemFiles)
      .values({
        id: "stable-library-id:bonus",
        itemId: original.id,
        rootId: root.id,
        rootRelativePath: "bonus.mp4",
        fileName: "bonus.mp4",
        directory: "",
        size: 1,
        modifiedAt: null,
        lastKnownPath: "bonus.mp4",
        createdAt,
        updatedAt: createdAt,
      })
      .run();
    const source = await library.resolveMaintenanceSource(sourcePath);
    await rename(sourcePath, targetPath);
    const targetStat = await stat(targetPath);
    const refreshedAt = new Date("2026-08-24T01:02:03.000Z");

    await library.commitRefresh({
      librarySource: source ?? undefined,
      sourceAbsolutePath: sourcePath,
      targetAbsolutePath: targetPath,
      size: targetStat.size,
      modifiedAt: targetStat.mtime,
      crawlerData: crawlerData("NEW-001"),
      fallbackNumber: "NEW-001",
      assets: { poster: posterPath, sceneImages: [], actorPhotos: [actorPhotoPath] },
      refreshedAt,
    });

    const updated = await library.getEntryById(original.id);
    expect(updated).toMatchObject({
      id: "stable-library-id",
      createdAt,
      sourceRunId: "scrape-task",
      sourceOutcomeId: "scrape-output",
      number: "NEW-001",
      rootRelativePath: "renamed.mp4",
      lastRefreshedAt: refreshedAt,
      thumbnailPath: "images/poster.jpg",
      thumbnailRootId: root.id,
    });
    expect(updated.files.map((file) => file.rootRelativePath).sort()).toEqual(["bonus.mp4", "renamed.mp4"]);
    expect(updated.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "poster",
          uri: "images/poster.jpg",
          rootId: root.id,
          relativePath: "images/poster.jpg",
        }),
        expect.objectContaining({
          kind: "actor",
          uri: ".actors/Actor.jpg",
          rootId: root.id,
          relativePath: ".actors/Actor.jpg",
        }),
      ]),
    );
    await expect(library.getEntry(root.id, "old.mp4")).rejects.toThrow("Library entry not found");
  });

  it("finds an existing item across different root IDs and maps assets to the longest containing root", async () => {
    const { directory, library, root, roots } = await createFixture();
    const nestedPath = path.join(directory.path, "nested");
    await mkdir(nestedPath, { recursive: true });
    const nestedRoot = createMediaRoot({ id: "root-nested", displayName: "Nested", hostPath: nestedPath });
    const duplicateInputRoot = createMediaRoot({
      id: "path-desktop-input",
      displayName: "Input",
      hostPath: root.hostPath,
    });
    await roots.upsert(nestedRoot);
    await roots.upsert(duplicateInputRoot);
    const videoPath = path.join(directory.path, "movie.mp4");
    const posterPath = path.join(nestedPath, "poster.jpg");
    await writeFile(videoPath, "video");
    await writeFile(posterPath, "poster");
    const original = await library.upsertEntry({
      id: "desktop-output-item",
      rootId: root.id,
      rootRelativePath: "movie.mp4",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
    });
    const source = await library.resolveMaintenanceSource(videoPath);
    expect(source).toMatchObject({ libraryItemId: original.id, rootId: root.id });
    const file = await stat(videoPath);
    await library.commitRefresh({
      librarySource: source ?? undefined,
      sourceAbsolutePath: videoPath,
      targetAbsolutePath: videoPath,
      size: file.size,
      modifiedAt: file.mtime,
      crawlerData: crawlerData("ROOT-001"),
      fallbackNumber: "ROOT-001",
      assets: { poster: posterPath, sceneImages: [], actorPhotos: [] },
      refreshedAt: new Date(),
    });
    const updated = await library.getEntryById(original.id);
    expect(updated.rootId).toBe(root.id);
    expect(updated.thumbnailRootId).toBe(nestedRoot.id);
    expect(updated.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "poster", rootId: nestedRoot.id, relativePath: "poster.jpg" }),
      ]),
    );
  });

  it("rejects a target owned by another item and creates a provenance-free item for an unregistered movie", async () => {
    const { directory, library, root } = await createFixture();
    const firstPath = path.join(directory.path, "first.mp4");
    const occupiedPath = path.join(directory.path, "occupied.mp4");
    const newPath = path.join(directory.path, "new.mp4");
    await Promise.all([writeFile(firstPath, "first"), writeFile(occupiedPath, "occupied"), writeFile(newPath, "new")]);
    await library.upsertEntry({ id: "first", rootId: root.id, rootRelativePath: "first.mp4" });
    await library.upsertEntry({ id: "occupied", rootId: root.id, rootRelativePath: "occupied.mp4" });
    const source = await library.resolveMaintenanceSource(firstPath);
    await expect(
      library.preflightMaintenanceRefresh({
        librarySource: source ?? undefined,
        sourceAbsolutePath: firstPath,
        targetAbsolutePath: occupiedPath,
      }),
    ).rejects.toThrow("已属于另一个媒体库条目");

    const file = await stat(newPath);
    const refreshedAt = new Date("2026-08-24T02:03:04.000Z");
    const created = await library.commitRefresh({
      sourceAbsolutePath: newPath,
      targetAbsolutePath: newPath,
      size: file.size,
      modifiedAt: file.mtime,
      crawlerData: crawlerData("NEW-002"),
      fallbackNumber: "NEW-002",
      assets: { sceneImages: [], actorPhotos: [] },
      refreshedAt,
    });
    expect(await library.getEntryById(created.libraryItemId)).toMatchObject({
      createdAt: refreshedAt,
      sourceRunId: null,
      sourceOutcomeId: null,
      number: "NEW-002",
    });
  });
});

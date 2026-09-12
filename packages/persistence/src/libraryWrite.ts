import { randomUUID } from "node:crypto";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import type { LibraryFileInput, LibraryMovieInput } from "./libraryRepository";
import { libraryItemAssets, libraryItemFiles, libraryItems, scrapeItemOutcomes } from "./schema";

const assetKey = (asset: {
  fileId: string | null;
  kind: string;
  rootId: string | null;
  relativePath: string | null;
  uri: string;
}): string => `${asset.fileId ?? "public"}:${asset.kind}:${asset.rootId ?? ""}:${asset.relativePath ?? asset.uri}`;

export const writeLibraryRows = (
  database: PersistenceDatabase,
  movie: LibraryMovieInput,
  inputs: readonly LibraryFileInput[],
): string => {
  if (!inputs.length) throw new Error("Library write group must not be empty");
  let itemId = movie.id;

  const resolved = inputs.map((input) => {
    const pathOccupant = database.db
      .select({ fileId: libraryItemFiles.id, itemId: libraryItemFiles.itemId })
      .from(libraryItemFiles)
      .where(
        and(eq(libraryItemFiles.rootId, input.rootId), eq(libraryItemFiles.rootRelativePath, input.rootRelativePath)),
      )
      .limit(1)
      .get();
    itemId ??= pathOccupant?.itemId ?? randomUUID();
    if (pathOccupant && pathOccupant.itemId !== itemId) {
      throw new Error(`媒体库路径已属于另一个条目：${input.rootId}:${input.rootRelativePath}`);
    }
    if (input.sourceOutcomeId) {
      const outcome = database.db
        .select({ outcome: scrapeItemOutcomes.outcome })
        .from(scrapeItemOutcomes)
        .where(eq(scrapeItemOutcomes.id, input.sourceOutcomeId))
        .get();
      if (outcome?.outcome !== "success") {
        throw new Error(`Library file source must be a successful scrape outcome: ${input.sourceOutcomeId}`);
      }
    }
    return { input, fileId: input.fileId ?? pathOccupant?.fileId ?? randomUUID() };
  });

  if (!itemId) throw new Error("Library movie ID was not resolved");
  const id = itemId;
  const createdAt = movie.createdAt ?? new Date();
  const mediaIdentity = movie.mediaIdentity ?? movie.number ?? id;
  const actorsJson = JSON.stringify(movie.actors ?? []);
  database.db
    .insert(libraryItems)
    .values({
      id,
      mediaIdentity,
      crawlerDataJson: movie.crawlerDataJson ?? null,
      title: movie.title ?? null,
      number: movie.number ?? null,
      actorsJson,
      createdAt,
      lastRefreshedAt: movie.lastRefreshedAt ?? null,
      hiddenFromRecentAt: null,
    })
    .onConflictDoUpdate({
      target: libraryItems.id,
      set: {
        mediaIdentity,
        crawlerDataJson: movie.crawlerDataJson ?? null,
        title: movie.title ?? null,
        number: movie.number ?? null,
        actorsJson,
        lastRefreshedAt: movie.lastRefreshedAt ?? null,
      },
    })
    .run();

  const now = new Date();
  for (const { input, fileId } of resolved) {
    const directory = path.posix.dirname(input.rootRelativePath);
    database.db
      .insert(libraryItemFiles)
      .values({
        id: fileId,
        itemId: id,
        rootId: input.rootId,
        rootRelativePath: input.rootRelativePath,
        fileName: path.posix.basename(input.rootRelativePath),
        directory: directory === "." ? "" : directory,
        size: input.size ?? 0,
        modifiedAt: input.modifiedAt ?? null,
        lastKnownPath: input.lastKnownPath ?? input.rootRelativePath,
        partNumber: input.partNumber ?? null,
        partSuffix: input.partSuffix ?? null,
        resolution: input.resolution ?? null,
        sourceOutcomeId: input.sourceOutcomeId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: libraryItemFiles.id,
        set: {
          rootId: input.rootId,
          rootRelativePath: input.rootRelativePath,
          fileName: path.posix.basename(input.rootRelativePath),
          directory: directory === "." ? "" : directory,
          size: input.size ?? 0,
          modifiedAt: input.modifiedAt ?? null,
          lastKnownPath: input.lastKnownPath ?? input.rootRelativePath,
          partNumber: input.partNumber ?? null,
          partSuffix: input.partSuffix ?? null,
          resolution: input.resolution ?? null,
          sourceOutcomeId: input.sourceOutcomeId ?? null,
          updatedAt: now,
        },
      })
      .run();
  }

  const affectedFileIds = new Set<string>();
  let replacesPublicAssets = false;
  const desiredAssets = new Map<
    string,
    {
      fileId: string | null;
      kind: string;
      uri: string;
      rootId: string | null;
      relativePath: string | null;
      published: boolean;
    }
  >();
  for (const { input, fileId } of resolved) {
    if (!input.assets) continue;
    affectedFileIds.add(fileId);
    replacesPublicAssets = true;
    for (const asset of input.assets) {
      if (!asset.uri.trim()) continue;
      const owningFileId = asset.kind === "strm" || asset.kind === "subtitle" ? (asset.fileId ?? fileId) : null;
      if (owningFileId) affectedFileIds.add(owningFileId);
      const desired = {
        fileId: owningFileId,
        kind: asset.kind,
        uri: asset.uri,
        rootId: asset.rootId ?? null,
        relativePath: asset.relativePath ?? null,
        published: asset.published ?? false,
      };
      desiredAssets.set(assetKey(desired), desired);
    }
  }
  if (!replacesPublicAssets && affectedFileIds.size === 0) return id;

  const previousAssets = database.db.select().from(libraryItemAssets).where(eq(libraryItemAssets.itemId, id)).all();
  const affectedAssets = previousAssets.filter(
    (asset) =>
      (asset.fileId === null && replacesPublicAssets) || (asset.fileId !== null && affectedFileIds.has(asset.fileId)),
  );
  const previousByKey = new Map(affectedAssets.map((asset) => [assetKey(asset), asset]));
  const retainedIds = new Set<string>();
  for (const [key, desired] of desiredAssets) {
    const previous = previousByKey.get(key);
    if (!previous) continue;
    retainedIds.add(previous.id);
    const published = previous.published || desired.published;
    if (previous.historical || previous.relativePath !== desired.relativePath || previous.published !== published) {
      database.db
        .update(libraryItemAssets)
        .set({ historical: false, relativePath: desired.relativePath, published })
        .where(eq(libraryItemAssets.id, previous.id))
        .run();
    }
  }

  const obsoleteIds: string[] = [];
  for (const previous of affectedAssets) {
    if (retainedIds.has(previous.id)) continue;
    if (previous.published && previous.kind === "strm") {
      if (!previous.historical) {
        database.db
          .update(libraryItemAssets)
          .set({ historical: true })
          .where(eq(libraryItemAssets.id, previous.id))
          .run();
      }
    } else {
      obsoleteIds.push(previous.id);
    }
  }
  if (obsoleteIds.length > 0) {
    database.db.delete(libraryItemAssets).where(inArray(libraryItemAssets.id, obsoleteIds)).run();
  }

  const inserted = [...desiredAssets.entries()]
    .filter(([key]) => !previousByKey.has(key))
    .map(([, asset]) => ({
      ...asset,
      id: randomUUID(),
      itemId: id,
      historical: false,
      createdAt: now,
    }));
  if (inserted.length > 0) database.db.insert(libraryItemAssets).values(inserted).run();
  return id;
};

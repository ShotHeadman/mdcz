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
  const id = movie.id;
  if (!id) throw new Error("Library write requires a declared movie ID");
  if (!inputs.length && !database.db.select().from(libraryItems).where(eq(libraryItems.id, id)).get()) {
    throw new Error("Asset-only library write requires an existing movie");
  }
  const resolved = inputs.map((input) => {
    if (!input.fileId) throw new Error("Library write requires a declared file ID");
    const pathOccupant = database.db
      .select({ fileId: libraryItemFiles.id, itemId: libraryItemFiles.itemId })
      .from(libraryItemFiles)
      .where(
        and(eq(libraryItemFiles.rootId, input.rootId), eq(libraryItemFiles.rootRelativePath, input.rootRelativePath)),
      )
      .limit(1)
      .get();
    if (pathOccupant && (pathOccupant.itemId !== id || pathOccupant.fileId !== input.fileId)) {
      throw new Error(`媒体库路径已属于另一个文件：${input.rootId}:${input.rootRelativePath}`);
    }
    const declaredFile = database.db.select().from(libraryItemFiles).where(eq(libraryItemFiles.id, input.fileId)).get();
    if (declaredFile && declaredFile.itemId !== id) throw new Error("Library file belongs to another movie");
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
    return { input, fileId: input.fileId };
  });
  const scopes = [
    { fileId: null, assets: movie.assets },
    ...resolved.map(({ input, fileId }) => ({ fileId, assets: input.assets })),
  ].filter((scope) => scope.assets !== undefined);
  for (const scope of scopes) {
    for (const asset of scope.assets ?? []) {
      const fileScoped = asset.kind === "strm" || asset.kind === "subtitle";
      if (fileScoped !== (scope.fileId !== null)) throw new Error(`Invalid library asset scope: ${asset.kind}`);
      if (!asset.uri.trim()) throw new Error("Library asset URI must not be empty");
    }
  }
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
        id,
        mediaIdentity: movie.mediaIdentity !== undefined || movie.number !== undefined ? mediaIdentity : undefined,
        crawlerDataJson: movie.crawlerDataJson,
        title: movie.title,
        number: movie.number,
        actorsJson: movie.actors === undefined ? undefined : actorsJson,
        lastRefreshedAt: movie.lastRefreshedAt,
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
          size: input.size,
          modifiedAt: input.modifiedAt,
          lastKnownPath: input.lastKnownPath,
          partNumber: input.partNumber,
          partSuffix: input.partSuffix,
          resolution: input.resolution,
          sourceOutcomeId: input.sourceOutcomeId,
          updatedAt: now,
        },
      })
      .run();
  }

  const affectedFileIds = new Set(scopes.flatMap((scope) => (scope.fileId ? [scope.fileId] : [])));
  const updatesMovieAssets = movie.assets !== undefined;
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
  for (const { assets, fileId } of scopes) {
    for (const asset of assets ?? []) {
      const desired = {
        fileId,
        kind: asset.kind,
        uri: asset.uri,
        rootId: asset.rootId ?? null,
        relativePath: asset.relativePath ?? null,
        published: asset.published ?? false,
      };
      desiredAssets.set(assetKey(desired), desired);
    }
  }
  if (!scopes.length) return id;

  const previousAssets = database.db.select().from(libraryItemAssets).where(eq(libraryItemAssets.itemId, id)).all();
  const affectedAssets = previousAssets.filter(
    (asset) =>
      (asset.fileId === null && updatesMovieAssets) || (asset.fileId !== null && affectedFileIds.has(asset.fileId)),
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

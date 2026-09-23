import { randomUUID } from "node:crypto";
import path from "node:path";
import { filesystemPathKey } from "@mdcz/media-store";
import { eq, inArray, or } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import type { LibraryFileInput, LibraryMovieInput } from "./libraryRepository";
import { libraryItemAssets, libraryItemFiles, libraryItems, mediaRoots } from "./schema";

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
  if (!movie.id) throw new Error("Library write requires a declared movie ID");
  if (!inputs.length && !database.db.select().from(libraryItems).where(eq(libraryItems.id, movie.id)).get()) {
    throw new Error("Asset-only library write requires an existing movie");
  }

  const targetPaths = new Set<string>();
  const roots = new Map(
    database.db
      .select()
      .from(mediaRoots)
      .all()
      .map((root) => [root.id, root]),
  );
  for (const input of inputs) {
    if (!input.fileId) throw new Error("Library write requires a declared file ID");
    const root = roots.get(input.rootId);
    if (!root) throw new Error(`Media root not found: ${input.rootId}`);
    input.entryIdentity ??= filesystemPathKey(path.resolve(root.realPath ?? root.hostPath, input.rootRelativePath));
    const pathKey = input.entryIdentity;
    if (targetPaths.has(pathKey)) throw new Error(`Duplicate library entry: ${pathKey}`);
    targetPaths.add(pathKey);
  }

  const occupants = inputs.map((input) => {
    const fileId = input.fileId;
    const entryIdentity = input.entryIdentity;
    if (!fileId || !entryIdentity) throw new Error("Library write requires a declared file ID and entry identity");
    const sourceIdentity = input.sourceEntryIdentity ?? entryIdentity;
    const matches = database.db
      .select()
      .from(libraryItemFiles)
      .where(
        or(eq(libraryItemFiles.id, fileId), inArray(libraryItemFiles.entryIdentity, [sourceIdentity, entryIdentity])),
      )
      .all();
    const declared = matches.find((file) => file.id === fileId);
    const source = matches.find((file) => file.entryIdentity === sourceIdentity);
    const target = matches.find((file) => file.entryIdentity === entryIdentity);
    if (declared && source && declared.id !== source.id) throw new Error("Library source belongs to another file");
    // A row already registered at the destination whose file is gone from disk is relinked rather than
    // duplicated; the caller verified the destination is unoccupied on disk before committing.
    return { input, occupant: declared ?? source ?? target, target };
  });

  const occupantItemIds = new Set(occupants.flatMap(({ occupant }) => (occupant ? [occupant.itemId] : [])));
  if (occupantItemIds.size > 1) throw new Error("Library paths belong to different movies");
  const id = occupantItemIds.values().next().value ?? movie.id;
  if (!id) throw new Error("Library write requires a declared movie ID");
  if (id !== movie.id && database.db.select().from(libraryItems).where(eq(libraryItems.id, movie.id)).get())
    throw new Error("Library write cannot merge independent movies");
  const movingFileIds = new Set(occupants.flatMap(({ occupant }) => (occupant ? [occupant.id] : [])));
  for (const { target } of occupants)
    if (target && !movingFileIds.has(target.id)) throw new Error("Library target belongs to another file");

  const resolved = occupants.map(({ input, occupant }) => {
    const declaredFileId = input.fileId;
    if (!declaredFileId) throw new Error("Library write requires a declared file ID");
    const fileId = occupant?.id ?? declaredFileId;
    const declaredFile = database.db.select().from(libraryItemFiles).where(eq(libraryItemFiles.id, fileId)).get();
    if (declaredFile && declaredFile.itemId !== id) throw new Error("Library file belongs to another movie");
    input.fileId = fileId;
    return { input, fileId };
  });

  const scopes = [
    { fileId: null, assets: movie.assets },
    ...resolved.map(({ input, fileId }) => ({ fileId, assets: input.assets })),
  ].filter((scope) => scope.assets !== undefined);

  for (const scope of scopes) {
    for (const asset of scope.assets ?? []) {
      const fileScoped = asset.kind === "subtitle";
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
      uncensoredAmbiguous: movie.uncensoredAmbiguous ?? false,
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
        uncensoredAmbiguous: movie.uncensoredAmbiguous === undefined ? undefined : movie.uncensoredAmbiguous,
      },
    })
    .run();

  const now = new Date();
  for (const { input, occupant } of occupants) {
    if (
      !occupant ||
      (occupant.rootId === input.rootId &&
        occupant.rootRelativePath === input.rootRelativePath &&
        occupant.entryIdentity === input.entryIdentity)
    )
      continue;
    database.db
      .update(libraryItemFiles)
      .set({ rootRelativePath: `.mdcz-relocating-${randomUUID()}`, entryIdentity: null })
      .where(eq(libraryItemFiles.id, occupant.id))
      .run();
  }
  for (const { input, fileId } of resolved) {
    const directory = path.posix.dirname(input.rootRelativePath);
    database.db
      .insert(libraryItemFiles)
      .values({
        id: fileId,
        itemId: id,
        rootId: input.rootId,
        rootRelativePath: input.rootRelativePath,
        entryIdentity: input.entryIdentity,
        fileName: path.posix.basename(input.rootRelativePath),
        directory: directory === "." ? "" : directory,
        size: input.size ?? 0,
        modifiedAt: input.modifiedAt ?? null,
        lastKnownPath: input.lastKnownPath ?? input.rootRelativePath,
        partNumber: input.partNumber ?? null,
        partSuffix: input.partSuffix ?? null,
        resolution: input.resolution ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: libraryItemFiles.id,
        set: {
          rootId: input.rootId,
          rootRelativePath: input.rootRelativePath,
          entryIdentity: input.entryIdentity,
          fileName: path.posix.basename(input.rootRelativePath),
          directory: directory === "." ? "" : directory,
          size: input.size,
          modifiedAt: input.modifiedAt,
          lastKnownPath: input.lastKnownPath,
          partNumber: input.partNumber,
          partSuffix: input.partSuffix,
          resolution: input.resolution,
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
    if (previous.relativePath !== desired.relativePath || previous.published !== published) {
      database.db
        .update(libraryItemAssets)
        .set({ relativePath: desired.relativePath, published })
        .where(eq(libraryItemAssets.id, previous.id))
        .run();
    }
  }

  const obsoleteIds: string[] = [];
  for (const previous of affectedAssets) {
    if (retainedIds.has(previous.id)) continue;
    obsoleteIds.push(previous.id);
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
      createdAt: now,
    }));
  if (inserted.length > 0) database.db.insert(libraryItemAssets).values(inserted).run();
  return id;
};

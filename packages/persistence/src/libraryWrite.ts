import { randomUUID } from "node:crypto";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import type { LibraryItemAssetRecord, UpsertLibraryEntryInput } from "./libraryRepository";
import { libraryItemAssets, libraryItemFiles, libraryItems } from "./schema";

const toAssetRows = (
  explicitAssets: UpsertLibraryEntryInput["assets"] = [],
): Array<Omit<LibraryItemAssetRecord, "itemId">> => {
  const now = new Date();
  const assets = new Map<string, Omit<LibraryItemAssetRecord, "itemId">>();
  for (const asset of explicitAssets) {
    if (!asset.uri.trim()) continue;
    assets.set(`${asset.kind}:${asset.uri}`, {
      id: randomUUID(),
      kind: asset.kind,
      uri: asset.uri,
      rootId: asset.rootId ?? null,
      relativePath: asset.relativePath ?? null,
      createdAt: now,
    });
  }
  return [...assets.values()];
};

export const writeLibraryRows = (database: PersistenceDatabase, input: UpsertLibraryEntryInput): string => {
  const id = input.id ?? `${input.rootId}:${input.rootRelativePath}`;
  const pathOccupant = database.db
    .select({ itemId: libraryItemFiles.itemId })
    .from(libraryItemFiles)
    .where(
      and(eq(libraryItemFiles.rootId, input.rootId), eq(libraryItemFiles.rootRelativePath, input.rootRelativePath)),
    )
    .limit(1)
    .get();
  if (pathOccupant && pathOccupant.itemId !== id) {
    throw new Error(`媒体库路径已属于另一个条目：${input.rootId}:${input.rootRelativePath}`);
  }
  const directory = path.posix.dirname(input.rootRelativePath);
  const createdAt = input.createdAt ?? new Date();
  const now = new Date();
  const actorsJson = JSON.stringify(input.actors ?? []);
  const mediaIdentity = input.mediaIdentity ?? input.number ?? id;
  const assets = toAssetRows(input.assets);

  database.db
    .insert(libraryItems)
    .values({
      id,
      mediaIdentity,
      crawlerDataJson: input.crawlerDataJson ?? null,
      sourceRunId: input.sourceRunId ?? null,
      sourceOutcomeId: input.sourceOutcomeId ?? null,
      title: input.title ?? null,
      number: input.number ?? null,
      actorsJson,
      createdAt,
      lastRefreshedAt: input.lastRefreshedAt ?? null,
      hiddenFromRecentAt: null,
    })
    .onConflictDoUpdate({
      target: libraryItems.id,
      set: {
        mediaIdentity,
        crawlerDataJson: input.crawlerDataJson ?? null,
        sourceRunId: input.sourceRunId ?? null,
        sourceOutcomeId: input.sourceOutcomeId ?? null,
        title: input.title ?? null,
        number: input.number ?? null,
        actorsJson,
        lastRefreshedAt: input.lastRefreshedAt ?? null,
      },
    })
    .run();
  database.db
    .insert(libraryItemFiles)
    .values({
      id: input.fileId ?? `${id}:primary`,
      itemId: id,
      rootId: input.rootId,
      rootRelativePath: input.rootRelativePath,
      fileName: path.posix.basename(input.rootRelativePath),
      directory: directory === "." ? "" : directory,
      size: input.size ?? 0,
      modifiedAt: input.modifiedAt ?? null,
      lastKnownPath: input.lastKnownPath ?? input.rootRelativePath,
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
        updatedAt: now,
      },
    })
    .run();
  database.db.delete(libraryItemAssets).where(eq(libraryItemAssets.itemId, id)).run();
  if (assets.length > 0) {
    database.db
      .insert(libraryItemAssets)
      .values(assets.map((asset) => ({ ...asset, itemId: id })))
      .run();
  }
  return id;
};

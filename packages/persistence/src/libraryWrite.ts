import { randomUUID } from "node:crypto";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import type { LibraryItemAssetRecord, UpsertLibraryEntryInput } from "./libraryRepository";
import { libraryItemAssets, libraryItemFiles, libraryItems } from "./schema";

const isUnknownRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const deriveAssets = (
  crawlerDataJson: string | null | undefined,
  thumbnailPath: string | null | undefined,
  explicitAssets: UpsertLibraryEntryInput["assets"] = [],
): Array<Omit<LibraryItemAssetRecord, "itemId">> => {
  const now = new Date();
  const assets = new Map<string, Omit<LibraryItemAssetRecord, "itemId">>();
  const add = (kind: string, uri: unknown, rootId: string | null = null, relativePath: string | null = null) => {
    if (typeof uri !== "string" || !uri.trim()) return;
    assets.set(`${kind}:${uri}`, {
      id: randomUUID(),
      kind,
      uri,
      rootId,
      relativePath,
      createdAt: now,
    });
  };

  add("thumb", thumbnailPath);
  for (const asset of explicitAssets) add(asset.kind, asset.uri, asset.rootId ?? null, asset.relativePath ?? null);
  if (crawlerDataJson) {
    try {
      const crawlerData: unknown = JSON.parse(crawlerDataJson);
      if (isUnknownRecord(crawlerData)) {
        add("thumb", crawlerData.thumb_url);
        add("poster", crawlerData.poster_url);
        add("fanart", crawlerData.fanart_url);
        add("trailer", crawlerData.trailer_url);
        for (const image of Array.isArray(crawlerData.scene_images) ? crawlerData.scene_images : [])
          add("scene", image);
      }
    } catch {
      // Keep malformed crawler data inspectable on the item; assets are a best-effort projection.
    }
  }
  return [...assets.values()];
};

export const writeLibraryEntry = (database: PersistenceDatabase, input: UpsertLibraryEntryInput): string => {
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
  const assets = deriveAssets(input.crawlerDataJson, input.thumbnailPath, input.assets);

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
      id: `${id}:primary`,
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

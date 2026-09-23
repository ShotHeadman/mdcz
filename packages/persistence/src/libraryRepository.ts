import { randomUUID } from "node:crypto";
import path from "node:path";
import { filesystemPathKey } from "@mdcz/media-store";
import { and, asc, desc, eq, inArray, isNotNull, or, type SQL, sql } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import { writeLibraryRows } from "./libraryWrite";
import {
  type LibraryItemAssetRow,
  type LibraryItemFileRow,
  type LibraryItemRow,
  libraryItemAssets,
  libraryItemFiles,
  libraryItems,
  mediaRoots,
} from "./schema";

export interface LibraryEntryRecord {
  id: string;
  mediaIdentity: string | null;
  displayFileId: string;
  size: number;
  title: string | null;
  number: string | null;
  actors: string[];
  crawlerDataJson: string | null;
  thumbnailPath: string | null;
  thumbnailRootId: string | null;
  createdAt: Date;
  lastRefreshedAt: Date | null;
  hiddenFromRecentAt: Date | null;
  uncensoredAmbiguous: boolean;
  files: LibraryItemFileRecord[];
  assets: LibraryItemAssetRecord[];
}

export interface LibraryMovieInput {
  id?: string;
  mediaIdentity?: string | null;
  title?: string | null;
  number?: string | null;
  actors?: string[];
  crawlerDataJson?: string | null;
  uncensoredAmbiguous?: boolean;
  createdAt?: Date;
  lastRefreshedAt?: Date | null;
  assets?: LibraryAssetInput[];
}

export interface LibraryAssetInput {
  kind: string;
  uri: string;
  rootId?: string | null;
  relativePath?: string | null;
  published?: boolean;
}

export interface LibraryFileInput {
  fileId?: string;
  entryIdentity?: string;
  sourceEntryIdentity?: string;
  rootId: string;
  rootRelativePath: string;
  size?: number;
  modifiedAt?: Date | null;
  partNumber?: number | null;
  partSuffix?: string | null;
  resolution?: string | null;
  assets?: LibraryAssetInput[];
  lastKnownPath?: string | null;
}

export interface UpsertLibraryEntryInput {
  movie: LibraryMovieInput;
  files: LibraryFileInput[];
}

export interface LibraryEntriesCursor {
  createdAt: Date;
  id: string;
}

export interface ListLibraryEntriesInput {
  cursor?: LibraryEntriesCursor;
  limit: number;
  query?: string;
  rootId?: string;
}

export interface LibraryEntriesPage {
  fileCount: number;
  totalBytes: number;
  entries: LibraryEntryRecord[];
  hasMore: boolean;
  nextCursor: LibraryEntriesCursor | null;
  total: number;
}

export interface LibraryAvailabilityEntryRecord {
  id: string;
  files: LibraryItemFileRecord[];
}

export interface LibraryOverviewEntryRecord {
  id: string;
  rootId: string;
  rootRelativePath: string;
  fileName: string;
  size: number;
  number: string | null;
  title: string | null;
  actors: string[];
  thumbnailPath: string | null;
  thumbnailRootId: string | null;
  lastKnownPath: string | null;
  createdAt: Date;
  hiddenFromRecentAt: Date | null;
}

export interface LibraryOverviewSummary {
  fileCount: number;
  totalBytes: number;
  latestEntryTimestamp: Date | null;
  recentEntries: LibraryOverviewEntryRecord[];
}

export interface LibraryItemFileRecord {
  id: string;
  itemId: string;
  rootId: string;
  rootRelativePath: string;
  fileName: string;
  directory: string;
  size: number;
  modifiedAt: Date | null;
  lastKnownPath: string | null;
  partNumber: number | null;
  partSuffix: string | null;
  resolution: string | null;
  sourceItemId: string | null;
  sourceRunId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LibraryItemAssetRecord {
  id: string;
  itemId: string;
  fileId: string | null;
  kind: string;
  uri: string;
  rootId: string | null;
  relativePath: string | null;
  published: boolean;
  createdAt: Date;
}

type RootPathCandidate = {
  hostPath: string;
  rootId: string;
  rootRelativePath: string;
};

const safeActors = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const toLibraryItemFileRecord = (
  row: LibraryItemFileRow,
  sourceRunId: string | null = null,
  sourceItemId: string | null = null,
): LibraryItemFileRecord => ({
  id: row.id,
  itemId: row.itemId,
  rootId: row.rootId,
  rootRelativePath: row.rootRelativePath,
  fileName: row.fileName,
  directory: row.directory,
  size: row.size,
  modifiedAt: row.modifiedAt,
  lastKnownPath: row.lastKnownPath,
  partNumber: row.partNumber,
  partSuffix: row.partSuffix,
  resolution: row.resolution,
  sourceItemId,
  sourceRunId,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toLibraryItemAssetRecord = (row: LibraryItemAssetRow): LibraryItemAssetRecord => ({
  id: row.id,
  itemId: row.itemId,
  fileId: row.fileId,
  kind: row.kind,
  uri: row.uri,
  rootId: row.rootId,
  relativePath: row.relativePath,
  published: row.published,
  createdAt: row.createdAt,
});

const resolutionRank = (resolution: string | null): number => {
  const value = resolution?.trim().toLowerCase();
  if (!value) return 0;
  if (value === "4k" || value.includes("2160")) return 2160;
  const vertical = value.match(/(?:^|\D)(\d{3,4})p?(?:\D|$)/u)?.[1];
  return vertical ? Number(vertical) : 0;
};

export const selectRepresentativeFile = <TFile extends Pick<LibraryItemFileRecord, "id" | "partNumber" | "resolution">>(
  files: readonly TFile[],
): TFile | undefined => {
  const parts = files.filter((file) => file.partNumber !== null && file.partNumber >= 1);
  const candidates = parts.length > 0 ? parts : files;
  return [...candidates].sort((left, right) => {
    if (parts.length > 0) {
      const partOrder = (left.partNumber ?? Number.MAX_SAFE_INTEGER) - (right.partNumber ?? Number.MAX_SAFE_INTEGER);
      if (partOrder !== 0) return partOrder;
    } else {
      const resolutionOrder = resolutionRank(right.resolution) - resolutionRank(left.resolution);
      if (resolutionOrder !== 0) return resolutionOrder;
    }
    return left.id.localeCompare(right.id);
  })[0];
};

const toLibraryEntryRecord = (
  item: LibraryItemRow,
  files: LibraryItemFileRecord[],
  assets: LibraryItemAssetRecord[],
): LibraryEntryRecord => {
  const primaryFile = selectRepresentativeFile(files);
  if (!primaryFile) {
    throw new Error(`Library item has no file refs: ${item.id}`);
  }
  const thumbnail =
    assets.find((asset) => asset.kind === "poster" && !isRemoteAssetUri(asset.uri)) ??
    assets.find((asset) => asset.kind === "thumb" && !isRemoteAssetUri(asset.uri)) ??
    assets.find((asset) => asset.kind === "poster" || asset.kind === "thumb");

  return {
    id: item.id,
    mediaIdentity: item.mediaIdentity,
    displayFileId: primaryFile.id,
    size: files.reduce((total, file) => total + Math.max(0, file.size), 0),
    title: item.title,
    number: item.number,
    actors: safeActors(item.actorsJson),
    crawlerDataJson: item.crawlerDataJson,
    thumbnailPath: thumbnail?.uri ?? null,
    thumbnailRootId: thumbnail?.rootId ?? null,
    createdAt: item.createdAt,
    lastRefreshedAt: item.lastRefreshedAt,
    hiddenFromRecentAt: item.hiddenFromRecentAt,
    uncensoredAmbiguous: item.uncensoredAmbiguous,
    files,
    assets,
  };
};

const isRemoteAssetUri = (value: string): boolean => /^https?:\/\//iu.test(value.trim());

export class LibraryRepository {
  constructor(private readonly database: PersistenceDatabase) {}

  publicationRoots() {
    return this.database.db.select({ id: mediaRoots.id, hostPath: mediaRoots.hostPath }).from(mediaRoots).all();
  }

  publicationSnapshot(query: { paths?: readonly string[]; kind?: string; includeOwners?: boolean }) {
    const roots = this.database.db.select().from(mediaRoots).all();
    const candidates = [...new Set(query.paths ?? [])].flatMap((value) => this.pathCandidates(value, roots));
    const locations = sql`SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]')
      FROM json_each(${JSON.stringify(candidates.map((ref) => [ref.rootId, ref.rootRelativePath]))})`;
    const fileWhere = sql`(${libraryItemFiles.rootId}, ${libraryItemFiles.rootRelativePath}) IN (${locations})`;
    const assetWhere =
      or(
        query.kind ? and(eq(libraryItemAssets.kind, query.kind), eq(libraryItemAssets.published, true)) : undefined,
        sql`(${libraryItemAssets.rootId}, ${libraryItemAssets.relativePath}) IN (${locations})`,
      ) ?? sql`0`;
    const owners = query.includeOwners
      ? [
          ...new Set(
            [
              ...this.database.db.select({ id: libraryItemFiles.itemId }).from(libraryItemFiles).where(fileWhere).all(),
              ...this.database.db
                .select({ id: libraryItemAssets.itemId })
                .from(libraryItemAssets)
                .where(assetWhere)
                .all(),
            ].map((row) => row.id),
          ),
        ]
      : [];
    return {
      files: this.database.db
        .select({
          fileId: libraryItemFiles.id,
          itemId: libraryItemFiles.itemId,
          mediaIdentity: libraryItems.mediaIdentity,
          size: libraryItemFiles.size,
          rootId: libraryItemFiles.rootId,
          relativePath: libraryItemFiles.rootRelativePath,
        })
        .from(libraryItemFiles)
        .innerJoin(libraryItems, eq(libraryItems.id, libraryItemFiles.itemId))
        .where(owners.length ? or(fileWhere, inArray(libraryItemFiles.itemId, owners)) : fileWhere)
        .all(),
      assets: this.database.db
        .select()
        .from(libraryItemAssets)
        .where(owners.length ? or(assetWhere, inArray(libraryItemAssets.itemId, owners)) : assetWhere)
        .all()
        .flatMap((asset) =>
          asset.rootId && asset.relativePath
            ? [
                {
                  itemId: asset.itemId,
                  fileId: asset.fileId,
                  kind: asset.kind,
                  rootId: asset.rootId,
                  relativePath: asset.relativePath,
                  published: asset.published,
                },
              ]
            : [],
        ),
    };
  }

  inventoryOwnership(refs?: readonly { rootId: string; relativePath: string; entryIdentity?: string }[]) {
    if (refs?.length === 0) return [];
    const roots = new Map(
      this.database.db
        .select()
        .from(mediaRoots)
        .all()
        .map((root) => [root.id, root]),
    );
    const identities = refs
      ? JSON.stringify(
          refs.map((ref) => {
            if (ref.entryIdentity) return ref.entryIdentity;
            const root = roots.get(ref.rootId);
            if (!root) throw new Error(`Media root not found: ${ref.rootId}`);
            return filesystemPathKey(path.resolve(root.realPath ?? root.hostPath, ref.relativePath));
          }),
        )
      : null;
    return this.database.sqlite
      .prepare<
        [string | null, string | null],
        {
          rootId: string;
          relativePath: string;
          movieId: string;
          fileId: string | null;
          kind: string;
          published: number;
        }
      >(`
      WITH selected AS (SELECT DISTINCT item_id FROM library_item_files
        WHERE ? IS NULL OR entry_identity IN (SELECT value FROM json_each(?)))
      SELECT root_id AS rootId, root_relative_path AS relativePath, item_id AS movieId, id AS fileId, 'video' AS kind, 1 AS published
      FROM library_item_files WHERE item_id IN (SELECT item_id FROM selected)
      UNION ALL
      SELECT root_id AS rootId, relative_path AS relativePath, item_id AS movieId, file_id AS fileId, kind, published
      FROM library_item_assets WHERE item_id IN (SELECT item_id FROM selected) AND root_id IS NOT NULL AND relative_path IS NOT NULL
    `)
      .all(identities, identities);
  }

  writeEntry(movie: LibraryMovieInput, files: readonly LibraryFileInput[]): string {
    return this.database.sqlite.transaction(() => writeLibraryRows(this.database, movie, files))();
  }

  async upsertEntry(input: UpsertLibraryEntryInput): Promise<LibraryEntryRecord> {
    const movie = { ...input.movie, id: input.movie.id ?? randomUUID() };
    const files = input.files.map((file) => ({ ...file, fileId: file.fileId ?? randomUUID() }));
    const transaction = this.database.sqlite.transaction(() => writeLibraryRows(this.database, movie, files));
    const id = transaction();
    return await this.getEntryById(id);
  }

  async touchEntry(id: string, refreshedAt = new Date()): Promise<LibraryEntryRecord> {
    this.database.db.update(libraryItems).set({ lastRefreshedAt: refreshedAt }).where(eq(libraryItems.id, id)).run();
    return await this.getEntryById(id);
  }

  async hideFromRecent(id: string, hiddenAt = new Date()): Promise<LibraryEntryRecord> {
    await this.getLibraryItem(id);
    this.database.db.update(libraryItems).set({ hiddenFromRecentAt: hiddenAt }).where(eq(libraryItems.id, id)).run();
    return await this.getEntryById(id);
  }

  async relinkFile(input: {
    fileId: string;
    entryIdentity?: string;
    rootId: string;
    rootRelativePath: string;
    size?: number;
    modifiedAt?: Date | null;
  }): Promise<LibraryEntryRecord> {
    const file = this.database.db.select().from(libraryItemFiles).where(eq(libraryItemFiles.id, input.fileId)).get();
    if (!file) throw new Error(`Library file not found: ${input.fileId}`);
    const root = this.database.db.select().from(mediaRoots).where(eq(mediaRoots.id, input.rootId)).get();
    if (!root) throw new Error(`Media root not found: ${input.rootId}`);
    if (
      [...new Set([root.hostPath, root.realPath].filter((value): value is string => Boolean(value)))].some((base) =>
        this.findLibraryFilesAtAbsolutePath(path.resolve(base, input.rootRelativePath)).some(
          (match) => match.file.id !== file.id,
        ),
      )
    )
      throw new Error("目标路径已属于另一个文件");
    const occupied = this.database.db
      .select({ id: libraryItemFiles.id })
      .from(libraryItemFiles)
      .where(
        and(eq(libraryItemFiles.rootId, input.rootId), eq(libraryItemFiles.rootRelativePath, input.rootRelativePath)),
      )
      .get();
    if (occupied && occupied.id !== file.id) {
      throw new Error(`媒体库路径已属于另一个文件：${input.rootId}:${input.rootRelativePath}`);
    }
    const directory = path.posix.dirname(input.rootRelativePath);
    const now = new Date();
    this.database.db
      .update(libraryItemFiles)
      .set({
        rootId: input.rootId,
        rootRelativePath: input.rootRelativePath,
        entryIdentity:
          input.entryIdentity ??
          filesystemPathKey(path.resolve(root.realPath ?? root.hostPath, input.rootRelativePath)),
        fileName: path.posix.basename(input.rootRelativePath),
        directory: directory === "." ? "" : directory,
        size: input.size ?? 0,
        modifiedAt: input.modifiedAt ?? null,
        lastKnownPath: input.rootRelativePath,
        updatedAt: now,
      })
      .where(eq(libraryItemFiles.id, file.id))
      .run();
    return await this.getEntryById(file.itemId);
  }

  async getEntryByFileId(fileId: string): Promise<LibraryEntryRecord> {
    const file = this.database.db.select().from(libraryItemFiles).where(eq(libraryItemFiles.id, fileId)).get();
    if (!file) throw new Error(`Library file not found: ${fileId}`);
    return this.getEntryById(file.itemId);
  }

  removeFile(fileId: string): void {
    const file = this.database.db.select().from(libraryItemFiles).where(eq(libraryItemFiles.id, fileId)).get();
    if (!file) throw new Error(`Library file not found: ${fileId}`);
    this.database.sqlite.transaction(() => {
      this.database.db.delete(libraryItemAssets).where(eq(libraryItemAssets.fileId, fileId)).run();
      this.database.db.delete(libraryItemFiles).where(eq(libraryItemFiles.id, fileId)).run();
      if (!this.database.db.select().from(libraryItemFiles).where(eq(libraryItemFiles.itemId, file.itemId)).get())
        this.deleteEntry(file.itemId);
    })();
  }

  deleteEntry(id: string): void {
    const item = this.database.db.select().from(libraryItems).where(eq(libraryItems.id, id)).limit(1).get();
    if (!item) throw new Error(`Library entry not found: ${id}`);
    this.database.sqlite.transaction(() => {
      this.database.db.delete(libraryItemAssets).where(eq(libraryItemAssets.itemId, id)).run();
      this.database.db.delete(libraryItemFiles).where(eq(libraryItemFiles.itemId, id)).run();
      this.database.db.delete(libraryItems).where(eq(libraryItems.id, id)).run();
    })();
  }

  async getEntry(rootId: string, rootRelativePath: string): Promise<LibraryEntryRecord> {
    const row = this.database.db
      .select()
      .from(libraryItemFiles)
      .where(
        and(
          eq(libraryItemFiles.rootId, rootId),
          or(
            eq(libraryItemFiles.rootRelativePath, rootRelativePath),
            eq(libraryItemFiles.lastKnownPath, rootRelativePath),
          ),
        ),
      )
      .limit(1)
      .get();
    if (!row) {
      throw new Error(`Library entry not found: ${rootId}:${rootRelativePath}`);
    }
    return await this.getEntryById(row.itemId);
  }

  async getEntryById(id: string): Promise<LibraryEntryRecord> {
    const item = this.database.db.select().from(libraryItems).where(eq(libraryItems.id, id)).get();
    if (!item) {
      const file = this.database.db.select().from(libraryItemFiles).where(eq(libraryItemFiles.id, id)).get();
      if (file) {
        const entry = await this.getEntryById(file.itemId);
        return {
          ...entry,
          files: [...entry.files.filter((f) => f.id === file.id), ...entry.files.filter((f) => f.id !== file.id)],
        };
      }
      throw new Error(`Library entry not found: ${id}`);
    }
    const [files, assets] = await Promise.all([this.listFilesForItems([id]), this.listAssetsForItems([id])]);
    return toLibraryEntryRecord(item, files.get(id) ?? [], assets.get(id) ?? []);
  }

  async listPendingUncensored(): Promise<LibraryEntryRecord[]> {
    const rows = this.database.db
      .select({ id: libraryItems.id })
      .from(libraryItems)
      .where(eq(libraryItems.uncensoredAmbiguous, true))
      .all();
    if (rows.length === 0) return [];
    return await this.getEntriesByIds(rows.map((row) => row.id));
  }

  async getEntriesByIds(ids: string[]): Promise<LibraryEntryRecord[]> {
    const normalizedIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (normalizedIds.length === 0) {
      return [];
    }
    const items = this.database.db.select().from(libraryItems).where(inArray(libraryItems.id, normalizedIds)).all();
    const [filesByItem, assetsByItem] = await Promise.all([
      this.listFilesForItems(normalizedIds),
      this.listAssetsForItems(normalizedIds),
    ]);
    const itemMap = new Map(items.map((item) => [item.id, item]));
    return normalizedIds.flatMap((id) => {
      const item = itemMap.get(id);
      return item ? [toLibraryEntryRecord(item, filesByItem.get(id) ?? [], assetsByItem.get(id) ?? [])] : [];
    });
  }

  async getAvailabilityEntriesByIds(ids: string[]): Promise<LibraryAvailabilityEntryRecord[]> {
    const normalizedIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (normalizedIds.length === 0) {
      return [];
    }
    const rows = this.database.db
      .select({ id: libraryItems.id })
      .from(libraryItems)
      .where(inArray(libraryItems.id, normalizedIds))
      .all();
    const filesByItem = await this.listFilesForItems(normalizedIds);
    const rowById = new Map(rows.map((row) => [row.id, row]));
    return normalizedIds.flatMap((id) => {
      const row = rowById.get(id);
      if (!row) return [];
      const files = filesByItem.get(row.id) ?? [];
      return files.length ? [{ id: row.id, files }] : [];
    });
  }

  async listEntries(): Promise<LibraryEntryRecord[]> {
    const items = this.database.db.select().from(libraryItems).orderBy(desc(libraryItems.createdAt)).all();
    const ids = items.map((item) => item.id);
    const [filesByItem, assetsByItem] = await Promise.all([this.listFilesForItems(ids), this.listAssetsForItems(ids)]);
    return items.map((item) =>
      toLibraryEntryRecord(item, filesByItem.get(item.id) ?? [], assetsByItem.get(item.id) ?? []),
    );
  }

  /**
   * Raw crawler payloads only — no file/asset joins and no record mapping. For callers that need a
   * single field out of every entry, this avoids the per-entry work a full listing would do.
   */
  async listCrawlerDataJson(): Promise<string[]> {
    return this.database.db
      .select({ crawlerDataJson: libraryItems.crawlerDataJson })
      .from(libraryItems)
      .where(isNotNull(libraryItems.crawlerDataJson))
      .all()
      .map((row) => row.crawlerDataJson)
      .filter((value): value is string => value !== null);
  }

  async listEntriesPage(input: ListLibraryEntriesInput): Promise<LibraryEntriesPage> {
    const limit = Math.max(1, Math.trunc(input.limit));
    const baseWhere = buildLibraryListWhere(input);
    const cursorTimestamp = input.cursor?.createdAt.getTime();
    const cursorWhere = input.cursor
      ? sql`(${libraryItems.createdAt} < ${cursorTimestamp} OR (${libraryItems.createdAt} = ${cursorTimestamp} AND ${libraryItems.id} < ${input.cursor.id}))`
      : undefined;
    const where = and(baseWhere, cursorWhere);
    const items = this.database.db
      .select()
      .from(libraryItems)
      .where(where)
      .orderBy(desc(libraryItems.createdAt), desc(libraryItems.id))
      .limit(limit + 1)
      .all();
    const hasMore = items.length > limit;
    const pageItems = hasMore ? items.slice(0, limit) : items;
    const ids = pageItems.map((item) => item.id);
    const [filesByItem, assetsByItem] = await Promise.all([this.listFilesForItems(ids), this.listAssetsForItems(ids)]);
    const entries = pageItems.map((item) =>
      toLibraryEntryRecord(item, filesByItem.get(item.id) ?? [], assetsByItem.get(item.id) ?? []),
    );
    const lastItem = pageItems.at(-1);
    const totals = this.database.db
      .select({
        fileCount: sql<number>`count(${libraryItemFiles.id})`,
        totalBytes: sql<number>`coalesce(sum(${libraryItemFiles.size}), 0)`,
      })
      .from(libraryItems)
      .innerJoin(libraryItemFiles, eq(libraryItemFiles.itemId, libraryItems.id))
      .where(baseWhere)
      .get();
    if (!totals) throw new Error("Library aggregate query returned no row");

    return {
      entries,
      hasMore,
      nextCursor:
        hasMore && lastItem
          ? {
              createdAt: lastItem.createdAt,
              id: lastItem.id,
            }
          : null,
      ...totals,
      total: this.getListCount(baseWhere),
    };
  }

  async getOverviewSummary(recentLimit: number): Promise<LibraryOverviewSummary> {
    const baseWhere = buildLibraryListWhere({});
    const aggregate = this.database.db
      .select({
        fileCount: sql<number>`count(${libraryItemFiles.id})`,
        totalBytes: sql<number>`coalesce(sum(${libraryItemFiles.size}), 0)`,
        latestEntryTimestamp: sql<Date | null>`max(${libraryItems.createdAt})`,
      })
      .from(libraryItems)
      .innerJoin(libraryItemFiles, eq(libraryItemFiles.itemId, libraryItems.id))
      .where(baseWhere)
      .get();
    const items = this.database.db
      .select()
      .from(libraryItems)
      .where(and(baseWhere, sql`${libraryItems.hiddenFromRecentAt} IS NULL`))
      .orderBy(desc(libraryItems.createdAt), desc(libraryItems.id))
      .limit(Math.max(1, Math.trunc(recentLimit)))
      .all();
    const itemIds = items.map((item) => item.id);
    const [filesByItem, assetsByItem] = await Promise.all([
      this.listFilesForItems(itemIds),
      this.listAssetsForItems(itemIds),
    ]);
    return {
      fileCount: Number(aggregate?.fileCount ?? 0),
      totalBytes: Number(aggregate?.totalBytes ?? 0),
      latestEntryTimestamp: aggregate?.latestEntryTimestamp ?? null,
      recentEntries: items.flatMap((item) => {
        const files = filesByItem.get(item.id) ?? [];
        const representativeFile = selectRepresentativeFile(files);
        const assets = assetsByItem.get(item.id) ?? [];
        const thumbnail =
          assets.find((asset) => asset.kind === "poster" && !isRemoteAssetUri(asset.uri)) ??
          assets.find((asset) => asset.kind === "thumb" && !isRemoteAssetUri(asset.uri)) ??
          assets.find((asset) => asset.kind === "poster" || asset.kind === "thumb");
        return representativeFile
          ? [
              {
                id: item.id,
                rootId: representativeFile.rootId,
                rootRelativePath: representativeFile.rootRelativePath,
                fileName: representativeFile.fileName,
                size: files.reduce((total, file) => total + Math.max(0, file.size), 0),
                number: item.number,
                title: item.title,
                actors: safeActors(item.actorsJson),
                thumbnailPath: thumbnail?.uri ?? null,
                thumbnailRootId: thumbnail?.rootId ?? null,
                lastKnownPath: representativeFile.lastKnownPath,
                createdAt: item.createdAt,
                hiddenFromRecentAt: item.hiddenFromRecentAt,
              },
            ]
          : [];
      }),
    };
  }

  private pathCandidates(
    absolutePath: string,
    roots = this.database.db.select().from(mediaRoots).all(),
  ): RootPathCandidate[] {
    const resolvedPath = path.resolve(absolutePath);
    const seen = new Set<string>();
    return roots
      .flatMap((root): RootPathCandidate[] =>
        [...new Set([root.hostPath, root.realPath].filter((value): value is string => Boolean(value)))].flatMap(
          (base): RootPathCandidate[] => {
            const resolvedRootPath = path.resolve(base);
            const relative = path.relative(resolvedRootPath, resolvedPath);
            if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
              return [];
            }
            const rootRelativePath = relative.replace(/\\/gu, "/");
            const key = `${root.id}\0${rootRelativePath}`;
            if (seen.has(key)) return [];
            seen.add(key);
            return [{ hostPath: resolvedRootPath, rootId: root.id, rootRelativePath }];
          },
        ),
      )
      .sort((left, right) => right.hostPath.length - left.hostPath.length || left.rootId.localeCompare(right.rootId));
  }

  private findLibraryFilesAtAbsolutePath(
    absolutePath: string,
  ): Array<{ candidate: RootPathCandidate; file: LibraryItemFileRow }> {
    return this.pathCandidates(absolutePath).flatMap((candidate) => {
      const file = this.database.db
        .select()
        .from(libraryItemFiles)
        .where(
          and(
            eq(libraryItemFiles.rootId, candidate.rootId),
            eq(libraryItemFiles.rootRelativePath, candidate.rootRelativePath),
          ),
        )
        .limit(1)
        .get();
      return file ? [{ candidate, file }] : [];
    });
  }

  private async getLibraryItem(id: string): Promise<LibraryItemRow> {
    const row = this.database.db.select().from(libraryItems).where(eq(libraryItems.id, id)).limit(1).get();
    if (!row) {
      throw new Error(`Library entry not found: ${id}`);
    }
    return row;
  }

  private async listFilesForItems(ids: string[]): Promise<Map<string, LibraryItemFileRecord[]>> {
    const rows =
      ids.length > 0
        ? this.database.db
            .select()
            .from(libraryItemFiles)
            .where(inArray(libraryItemFiles.itemId, ids))
            .orderBy(asc(libraryItemFiles.partNumber), asc(libraryItemFiles.createdAt), asc(libraryItemFiles.id))
            .all()
        : [];
    return groupByItem(rows.map((row) => toLibraryItemFileRecord(row)));
  }

  private async listAssetsForItems(ids: string[]): Promise<Map<string, LibraryItemAssetRecord[]>> {
    const rows =
      ids.length > 0
        ? this.database.db
            .select()
            .from(libraryItemAssets)
            .where(inArray(libraryItemAssets.itemId, ids))
            .orderBy(libraryItemAssets.kind)
            .all()
        : [];
    return groupByItem(rows.map(toLibraryItemAssetRecord));
  }

  private getListCount(baseWhere: SQL | undefined): number {
    return Number(
      this.database.db.select({ count: sql<number>`count(*)` }).from(libraryItems).where(baseWhere).get()?.count ?? 0,
    );
  }
}

const buildLibraryListWhere = (input: Pick<ListLibraryEntriesInput, "query" | "rootId">): SQL | undefined => {
  const filters: SQL[] = [];
  const rootId = input.rootId?.trim();
  if (rootId) {
    filters.push(
      sql`EXISTS (
        SELECT 1
        FROM library_item_files AS root_file
        LEFT JOIN media_roots AS root ON root.id = root_file.root_id
        WHERE root_file.item_id = ${libraryItems.id}
          AND root_file.root_id = ${rootId}
      )`,
    );
  }

  const query = input.query?.trim().toLowerCase();
  if (query) {
    const pattern = `%${escapeLikePattern(query)}%`;
    const escapeClause = sql`ESCAPE '\\'`;
    filters.push(
      sql`(
        lower(coalesce(${libraryItems.title}, '')) LIKE ${pattern} ${escapeClause}
        OR lower(coalesce(${libraryItems.number}, '')) LIKE ${pattern} ${escapeClause}
        OR lower(coalesce(${libraryItems.mediaIdentity}, '')) LIKE ${pattern} ${escapeClause}
        OR lower(coalesce(${libraryItems.actorsJson}, '')) LIKE ${pattern} ${escapeClause}
        OR EXISTS (
          SELECT 1
          FROM library_item_files AS search_file
          WHERE search_file.item_id = ${libraryItems.id}
            AND (
              lower(search_file.file_name) LIKE ${pattern} ${escapeClause}
              OR lower(search_file.root_relative_path) LIKE ${pattern} ${escapeClause}
            )
        )
        OR EXISTS (
          SELECT 1
          FROM library_item_files AS display_file
          INNER JOIN media_roots AS display_root ON display_root.id = display_file.root_id
          WHERE display_file.item_id = ${libraryItems.id}
            AND lower(display_root.display_name) LIKE ${pattern} ${escapeClause}
        )
      )`,
    );
  }

  return filters.length > 0 ? and(...filters) : undefined;
};

const escapeLikePattern = (value: string): string => value.replaceAll(/[\\%_]/gu, (character) => `\\${character}`);

const groupByItem = <TRecord extends { itemId: string }>(records: TRecord[]): Map<string, TRecord[]> => {
  const grouped = new Map<string, TRecord[]>();
  for (const record of records) {
    const group = grouped.get(record.itemId) ?? [];
    group.push(record);
    grouped.set(record.itemId, group);
  }
  return grouped;
};

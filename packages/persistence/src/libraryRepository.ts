import { randomUUID } from "node:crypto";
import path from "node:path";
import { and, desc, eq, inArray, isNotNull, type SQL, sql } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import {
  type LibraryItemAssetRow,
  type LibraryItemFileRow,
  type LibraryItemRow,
  libraryItemAssets,
  libraryItemFiles,
  libraryItems,
  type ScrapeOutputRow,
  type ScrapeResultRow,
  scrapeOutputs,
  scrapeResults,
} from "./schema";

export type ScrapeResultRecordStatus = "pending" | "processing" | "success" | "failed" | "skipped";

export interface ScrapeOutputRecord {
  id: string;
  taskId: string | null;
  rootId: string | null;
  outputDirectory: string | null;
  fileCount: number;
  totalBytes: number;
  completedAt: Date;
  createdAt: Date;
}

export interface LibraryEntryRecord {
  id: string;
  mediaIdentity: string | null;
  rootId: string;
  rootRelativePath: string;
  fileName: string;
  directory: string;
  size: number;
  modifiedAt: Date | null;
  sourceTaskId: string | null;
  scrapeOutputId: string | null;
  title: string | null;
  number: string | null;
  actors: string[];
  crawlerDataJson: string | null;
  thumbnailPath: string | null;
  lastKnownPath: string | null;
  createdAt: Date;
  lastRefreshedAt: Date | null;
  hiddenFromRecentAt: Date | null;
  files: LibraryItemFileRecord[];
  assets: LibraryItemAssetRecord[];
}

export interface ScrapeResultRecord {
  id: string;
  taskId: string;
  rootId: string;
  relativePath: string;
  status: ScrapeResultRecordStatus;
  error: string | null;
  crawlerDataJson: string | null;
  nfoRootId: string | null;
  nfoRelativePath: string | null;
  outputRelativePath: string | null;
  manualUrl: string | null;
  uncensoredAmbiguous: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertScrapeOutputInput {
  id?: string;
  taskId?: string | null;
  rootId?: string | null;
  outputDirectory?: string | null;
  fileCount: number;
  totalBytes: number;
  completedAt: Date;
  createdAt?: Date;
}

export interface UpsertLibraryEntryInput {
  id?: string;
  mediaIdentity?: string | null;
  rootId: string;
  rootRelativePath: string;
  size?: number;
  modifiedAt?: Date | null;
  sourceTaskId?: string | null;
  scrapeOutputId?: string | null;
  title?: string | null;
  number?: string | null;
  actors?: string[];
  crawlerDataJson?: string | null;
  thumbnailPath?: string | null;
  assets?: Array<{ kind: string; uri: string; rootId?: string | null; relativePath?: string | null }>;
  lastKnownPath?: string | null;
  createdAt?: Date;
  lastRefreshedAt?: Date | null;
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
  entries: LibraryEntryRecord[];
  hasMore: boolean;
  nextCursor: LibraryEntriesCursor | null;
  total: number;
}

export interface LibraryAvailabilityEntryRecord {
  id: string;
  rootId: string;
  rootRelativePath: string;
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
  createdAt: Date;
  updatedAt: Date;
}

export interface LibraryItemAssetRecord {
  id: string;
  itemId: string;
  kind: string;
  uri: string;
  rootId: string | null;
  relativePath: string | null;
  createdAt: Date;
}

export interface UpsertScrapeResultInput {
  id?: string;
  taskId: string;
  rootId: string;
  relativePath: string;
  status: ScrapeResultRecordStatus;
  error?: string | null;
  crawlerDataJson?: string | null;
  nfoRootId?: string | null;
  nfoRelativePath?: string | null;
  outputRelativePath?: string | null;
  manualUrl?: string | null;
  uncensoredAmbiguous?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const safeActors = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const toScrapeOutputRecord = (row: ScrapeOutputRow): ScrapeOutputRecord => ({
  id: row.id,
  taskId: row.taskId,
  rootId: row.rootId,
  outputDirectory: row.outputDirectory,
  fileCount: row.fileCount,
  totalBytes: row.totalBytes,
  completedAt: row.completedAt,
  createdAt: row.createdAt,
});

const toLibraryItemFileRecord = (row: LibraryItemFileRow): LibraryItemFileRecord => ({
  id: row.id,
  itemId: row.itemId,
  rootId: row.rootId,
  rootRelativePath: row.rootRelativePath,
  fileName: row.fileName,
  directory: row.directory,
  size: row.size,
  modifiedAt: row.modifiedAt,
  lastKnownPath: row.lastKnownPath,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toLibraryItemAssetRecord = (row: LibraryItemAssetRow): LibraryItemAssetRecord => ({
  id: row.id,
  itemId: row.itemId,
  kind: row.kind,
  uri: row.uri,
  rootId: row.rootId,
  relativePath: row.relativePath,
  createdAt: row.createdAt,
});

const toLibraryEntryRecord = (
  item: LibraryItemRow,
  files: LibraryItemFileRecord[],
  assets: LibraryItemAssetRecord[],
): LibraryEntryRecord => {
  const primaryFile = files[0];
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
    rootId: primaryFile.rootId,
    rootRelativePath: primaryFile.rootRelativePath,
    fileName: primaryFile.fileName,
    directory: primaryFile.directory,
    size: primaryFile.size,
    modifiedAt: primaryFile.modifiedAt,
    sourceTaskId: item.sourceTaskId,
    scrapeOutputId: item.scrapeOutputId,
    title: item.title,
    number: item.number,
    actors: safeActors(item.actorsJson),
    crawlerDataJson: item.crawlerDataJson,
    thumbnailPath: thumbnail?.uri ?? null,
    lastKnownPath: primaryFile.lastKnownPath,
    createdAt: item.createdAt,
    lastRefreshedAt: item.lastRefreshedAt,
    hiddenFromRecentAt: item.hiddenFromRecentAt,
    files,
    assets,
  };
};

const isRemoteAssetUri = (value: string): boolean => /^https?:\/\//iu.test(value.trim());

const toScrapeResultRecord = (row: ScrapeResultRow): ScrapeResultRecord => ({
  id: row.id,
  taskId: row.taskId,
  rootId: row.rootId,
  relativePath: row.relativePath,
  status: row.status as ScrapeResultRecordStatus,
  error: row.errorMessage,
  crawlerDataJson: row.crawlerDataJson,
  nfoRootId: row.nfoRootId,
  nfoRelativePath: row.nfoRelativePath,
  outputRelativePath: row.outputRelativePath,
  manualUrl: row.manualUrl,
  uncensoredAmbiguous: row.uncensoredAmbiguous,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export class LibraryRepository {
  private readonly listCountCache = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly database: PersistenceDatabase) {}

  async upsertScrapeOutput(input: UpsertScrapeOutputInput): Promise<ScrapeOutputRecord> {
    const id = input.id ?? randomUUID();
    const createdAt = input.createdAt ?? new Date();
    this.database.db
      .insert(scrapeOutputs)
      .values({
        id,
        taskId: input.taskId ?? null,
        rootId: input.rootId ?? null,
        outputDirectory: input.outputDirectory ?? null,
        fileCount: input.fileCount,
        totalBytes: input.totalBytes,
        completedAt: input.completedAt,
        createdAt,
      })
      .onConflictDoUpdate({
        target: scrapeOutputs.id,
        set: {
          taskId: input.taskId ?? null,
          rootId: input.rootId ?? null,
          outputDirectory: input.outputDirectory ?? null,
          fileCount: input.fileCount,
          totalBytes: input.totalBytes,
          completedAt: input.completedAt,
        },
      })
      .run();
    return await this.getScrapeOutput(id);
  }

  async latestScrapeOutput(): Promise<ScrapeOutputRecord | null> {
    const row = this.database.db.select().from(scrapeOutputs).orderBy(desc(scrapeOutputs.completedAt)).limit(1).get();
    return row ? toScrapeOutputRecord(row) : null;
  }

  async getScrapeOutput(id: string): Promise<ScrapeOutputRecord> {
    const row = this.database.db.select().from(scrapeOutputs).where(eq(scrapeOutputs.id, id)).limit(1).get();
    if (!row) {
      throw new Error(`Scrape output not found: ${id}`);
    }
    return toScrapeOutputRecord(row);
  }

  async upsertEntry(input: UpsertLibraryEntryInput): Promise<LibraryEntryRecord> {
    const id = input.id ?? `${input.rootId}:${input.rootRelativePath}`;
    const directory = path.posix.dirname(input.rootRelativePath);
    const createdAt = input.createdAt ?? new Date();
    const now = new Date();
    const actorsJson = JSON.stringify(input.actors ?? []);
    const mediaIdentity = input.mediaIdentity ?? input.number ?? id;
    const assets = deriveAssets(input.crawlerDataJson, input.thumbnailPath, input.assets);

    const transaction = this.database.sqlite.transaction(() => {
      this.database.db
        .insert(libraryItems)
        .values({
          id,
          mediaIdentity,
          crawlerDataJson: input.crawlerDataJson ?? null,
          sourceTaskId: input.sourceTaskId ?? null,
          scrapeOutputId: input.scrapeOutputId ?? null,
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
            sourceTaskId: input.sourceTaskId ?? null,
            scrapeOutputId: input.scrapeOutputId ?? null,
            title: input.title ?? null,
            number: input.number ?? null,
            actorsJson,
            lastRefreshedAt: input.lastRefreshedAt ?? null,
          },
        })
        .run();

      this.database.db
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
          target: [libraryItemFiles.itemId, libraryItemFiles.rootId, libraryItemFiles.rootRelativePath],
          set: {
            fileName: path.posix.basename(input.rootRelativePath),
            directory: directory === "." ? "" : directory,
            size: input.size ?? 0,
            modifiedAt: input.modifiedAt ?? null,
            lastKnownPath: input.lastKnownPath ?? input.rootRelativePath,
            updatedAt: now,
          },
        })
        .run();

      this.database.db.delete(libraryItemAssets).where(eq(libraryItemAssets.itemId, id)).run();
      if (assets.length > 0) {
        this.database.db
          .insert(libraryItemAssets)
          .values(assets.map((asset) => ({ ...asset, itemId: id })))
          .run();
      }
    });
    transaction();
    this.invalidateListCounts();
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

  async relinkEntry(input: {
    id: string;
    rootId: string;
    rootRelativePath: string;
    size?: number;
    modifiedAt?: Date | null;
  }): Promise<LibraryEntryRecord> {
    const item = await this.getLibraryItem(input.id);
    const directory = path.posix.dirname(input.rootRelativePath);
    const now = new Date();
    this.database.db
      .update(libraryItemFiles)
      .set({
        rootId: input.rootId,
        rootRelativePath: input.rootRelativePath,
        fileName: path.posix.basename(input.rootRelativePath),
        directory: directory === "." ? "" : directory,
        size: input.size ?? 0,
        modifiedAt: input.modifiedAt ?? null,
        lastKnownPath: input.rootRelativePath,
        updatedAt: now,
      })
      .where(eq(libraryItemFiles.id, `${item.id}:primary`))
      .run();
    this.invalidateListCounts();
    return await this.touchEntry(item.id, now);
  }

  async deleteEntriesForTask(taskId: string): Promise<void> {
    const rows = this.database.db
      .select({ id: libraryItems.id })
      .from(libraryItems)
      .where(eq(libraryItems.sourceTaskId, taskId))
      .all();
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) {
      return;
    }
    const transaction = this.database.sqlite.transaction(() => {
      this.database.db.delete(libraryItemAssets).where(inArray(libraryItemAssets.itemId, ids)).run();
      this.database.db.delete(libraryItemFiles).where(inArray(libraryItemFiles.itemId, ids)).run();
      this.database.db.delete(libraryItems).where(inArray(libraryItems.id, ids)).run();
    });
    transaction();
    this.invalidateListCounts();
  }

  async deleteEntry(id: string): Promise<void> {
    await this.getLibraryItem(id);
    const transaction = this.database.sqlite.transaction(() => {
      this.database.db.delete(libraryItemAssets).where(eq(libraryItemAssets.itemId, id)).run();
      this.database.db.delete(libraryItemFiles).where(eq(libraryItemFiles.itemId, id)).run();
      this.database.db.delete(libraryItems).where(eq(libraryItems.id, id)).run();
    });
    transaction();
    this.invalidateListCounts();
  }

  async upsertScrapeResult(input: UpsertScrapeResultInput): Promise<ScrapeResultRecord> {
    const id = input.id ?? randomUUID();
    const now = new Date();
    const createdAt = input.createdAt ?? now;
    const updatedAt = input.updatedAt ?? now;
    this.database.db
      .insert(scrapeResults)
      .values({
        id,
        taskId: input.taskId,
        rootId: input.rootId,
        relativePath: input.relativePath,
        status: input.status,
        errorMessage: input.error ?? null,
        crawlerDataJson: input.crawlerDataJson ?? null,
        nfoRootId: input.nfoRootId ?? null,
        nfoRelativePath: input.nfoRelativePath ?? null,
        outputRelativePath: input.outputRelativePath ?? null,
        manualUrl: input.manualUrl ?? null,
        uncensoredAmbiguous: input.uncensoredAmbiguous ?? false,
        createdAt,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: scrapeResults.id,
        set: {
          status: input.status,
          errorMessage: input.error ?? null,
          crawlerDataJson: input.crawlerDataJson ?? null,
          nfoRootId: input.nfoRootId ?? null,
          nfoRelativePath: input.nfoRelativePath ?? null,
          outputRelativePath: input.outputRelativePath ?? null,
          manualUrl: input.manualUrl ?? null,
          uncensoredAmbiguous: input.uncensoredAmbiguous ?? false,
          updatedAt,
        },
      })
      .run();
    return await this.getScrapeResult(id);
  }

  async listScrapeResults(taskId?: string): Promise<ScrapeResultRecord[]> {
    const rows = taskId
      ? this.database.db
          .select()
          .from(scrapeResults)
          .where(eq(scrapeResults.taskId, taskId))
          .orderBy(scrapeResults.relativePath)
          .all()
      : this.database.db.select().from(scrapeResults).orderBy(desc(scrapeResults.updatedAt)).all();
    return rows.map(toScrapeResultRecord);
  }

  async getScrapeResult(id: string): Promise<ScrapeResultRecord> {
    const row = this.database.db.select().from(scrapeResults).where(eq(scrapeResults.id, id)).limit(1).get();
    if (!row) {
      throw new Error(`Scrape result not found: ${id}`);
    }
    return toScrapeResultRecord(row);
  }

  async deleteScrapeResultsForTask(taskId: string): Promise<void> {
    this.database.db.delete(scrapeResults).where(eq(scrapeResults.taskId, taskId)).run();
  }

  async getEntry(rootId: string, rootRelativePath: string): Promise<LibraryEntryRecord> {
    const row = this.database.db
      .select()
      .from(libraryItemFiles)
      .where(sql`${libraryItemFiles.rootId} = ${rootId} AND ${libraryItemFiles.rootRelativePath} = ${rootRelativePath}`)
      .limit(1)
      .get();
    if (!row) {
      throw new Error(`Library entry not found: ${rootId}:${rootRelativePath}`);
    }
    return await this.getEntryById(row.itemId);
  }

  async getEntryById(id: string): Promise<LibraryEntryRecord> {
    const item = await this.getLibraryItem(id);
    const [files, assets] = await Promise.all([this.listFilesForItems([id]), this.listAssetsForItems([id])]);
    return toLibraryEntryRecord(item, files.get(id) ?? [], assets.get(id) ?? []);
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
      const primaryFile = files.find((file) => file.id === `${row.id}:primary`) ?? files[0];
      return primaryFile
        ? [{ id: row.id, rootId: primaryFile.rootId, rootRelativePath: primaryFile.rootRelativePath, files }]
        : [];
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
      total: this.getListCount(baseWhere, input),
    };
  }

  async getOverviewSummary(recentLimit: number): Promise<LibraryOverviewSummary> {
    const baseWhere = buildLibraryListWhere({});
    const aggregate = this.database.db
      .select({
        fileCount: sql<number>`count(*)`,
        totalBytes: sql<number>`coalesce(sum(${libraryItemFiles.size}), 0)`,
        latestEntryTimestamp: sql<Date | null>`max(${libraryItems.createdAt})`,
      })
      .from(libraryItems)
      .innerJoin(
        libraryItemFiles,
        and(
          eq(libraryItemFiles.itemId, libraryItems.id),
          sql`${libraryItemFiles.id} = ${libraryItems.id} || ':primary'`,
        ),
      )
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
        const primaryFile = files.find((file) => file.id === `${item.id}:primary`) ?? files[0];
        const assets = assetsByItem.get(item.id) ?? [];
        const thumbnail =
          assets.find((asset) => asset.kind === "poster" && !isRemoteAssetUri(asset.uri)) ??
          assets.find((asset) => asset.kind === "thumb" && !isRemoteAssetUri(asset.uri)) ??
          assets.find((asset) => asset.kind === "poster" || asset.kind === "thumb");
        return primaryFile
          ? [
              {
                id: item.id,
                rootId: primaryFile.rootId,
                rootRelativePath: primaryFile.rootRelativePath,
                fileName: primaryFile.fileName,
                size: primaryFile.size,
                number: item.number,
                title: item.title,
                actors: safeActors(item.actorsJson),
                thumbnailPath: thumbnail?.uri ?? null,
                lastKnownPath: primaryFile.lastKnownPath,
                createdAt: item.createdAt,
                hiddenFromRecentAt: item.hiddenFromRecentAt,
              },
            ]
          : [];
      }),
    };
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
            .orderBy(libraryItemFiles.createdAt)
            .all()
        : [];
    return groupByItem(rows.map(toLibraryItemFileRecord));
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

  private getListCount(baseWhere: SQL | undefined, input: Pick<ListLibraryEntriesInput, "query" | "rootId">): number {
    const key = JSON.stringify([input.query?.trim().toLowerCase() ?? "", input.rootId?.trim() ?? ""]);
    const cached = this.listCountCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.count;
    }
    const count = Number(
      this.database.db.select({ count: sql<number>`count(*)` }).from(libraryItems).where(baseWhere).get()?.count ?? 0,
    );
    this.listCountCache.set(key, { count, expiresAt: Date.now() + 30_000 });
    return count;
  }

  private invalidateListCounts(): void {
    this.listCountCache.clear();
  }
}

const buildLibraryListWhere = (input: Pick<ListLibraryEntriesInput, "query" | "rootId">): SQL | undefined => {
  const filters: SQL[] = [];
  const activeRootExists = sql`(
    EXISTS (
      SELECT 1
      FROM library_item_files AS active_root_file
      INNER JOIN media_roots AS active_root ON active_root.id = active_root_file.root_id
      WHERE active_root_file.item_id = ${libraryItems.id}
        AND active_root.deleted = 0
    )
    OR NOT EXISTS (
      SELECT 1
      FROM library_item_files AS root_presence
      INNER JOIN media_roots AS any_root ON any_root.id = root_presence.root_id
      WHERE root_presence.item_id = ${libraryItems.id}
    )
  )`;
  filters.push(activeRootExists);
  const rootId = input.rootId?.trim();
  if (rootId) {
    filters.push(
      sql`EXISTS (
        SELECT 1
        FROM library_item_files AS root_file
        LEFT JOIN media_roots AS root ON root.id = root_file.root_id
        WHERE root_file.item_id = ${libraryItems.id}
          AND root_file.root_id = ${rootId}
          AND (root.id IS NULL OR root.deleted = 0)
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
            AND display_root.deleted = 0
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

const deriveAssets = (
  crawlerDataJson: string | null | undefined,
  thumbnailPath: string | null | undefined,
  explicitAssets: UpsertLibraryEntryInput["assets"] = [],
): Array<Omit<LibraryItemAssetRecord, "itemId">> => {
  const now = new Date();
  const assets = new Map<string, Omit<LibraryItemAssetRecord, "itemId">>();
  const add = (kind: string, uri: unknown, rootId: string | null = null, relativePath: string | null = null) => {
    if (typeof uri !== "string" || !uri.trim()) {
      return;
    }
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
  for (const asset of explicitAssets) {
    add(asset.kind, asset.uri, asset.rootId ?? null, asset.relativePath ?? null);
  }
  if (crawlerDataJson) {
    try {
      const crawlerData = JSON.parse(crawlerDataJson) as Record<string, unknown>;
      add("thumb", crawlerData.thumb_url);
      add("poster", crawlerData.poster_url);
      add("fanart", crawlerData.fanart_url);
      add("trailer", crawlerData.trailer_url);
      for (const image of Array.isArray(crawlerData.scene_images) ? crawlerData.scene_images : []) {
        add("scene", image);
      }
    } catch {
      // Keep malformed crawler data inspectable on the item; assets are a best-effort projection.
    }
  }

  return [...assets.values()];
};

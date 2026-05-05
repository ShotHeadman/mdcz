import { randomUUID } from "node:crypto";
import path from "node:path";
import { desc, eq, inArray, sql } from "drizzle-orm";
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
  indexedAt: Date;
  lastRefreshedAt: Date | null;
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
  indexedAt?: Date;
  lastRefreshedAt?: Date | null;
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
    assets.find((asset) => asset.kind === "thumb" && !isRemoteAssetUri(asset.uri)) ??
    assets.find((asset) => asset.kind === "poster" && !isRemoteAssetUri(asset.uri)) ??
    assets.find((asset) => asset.kind === "thumb" || asset.kind === "poster");

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
    indexedAt: item.indexedAt,
    lastRefreshedAt: item.lastRefreshedAt,
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
  nfoRelativePath: row.nfoRelativePath,
  outputRelativePath: row.outputRelativePath,
  manualUrl: row.manualUrl,
  uncensoredAmbiguous: row.uncensoredAmbiguous,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export class LibraryRepository {
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
    const indexedAt = input.indexedAt ?? new Date();
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
          indexedAt,
          lastRefreshedAt: input.lastRefreshedAt ?? null,
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
            indexedAt,
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
    return await this.getEntry(input.rootId, input.rootRelativePath);
  }

  async touchEntry(id: string, refreshedAt = new Date()): Promise<LibraryEntryRecord> {
    this.database.db.update(libraryItems).set({ lastRefreshedAt: refreshedAt }).where(eq(libraryItems.id, id)).run();
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
      .insert(libraryItemFiles)
      .values({
        id: `${input.id}:primary`,
        itemId: item.id,
        rootId: input.rootId,
        rootRelativePath: input.rootRelativePath,
        fileName: path.posix.basename(input.rootRelativePath),
        directory: directory === "." ? "" : directory,
        size: input.size ?? 0,
        modifiedAt: input.modifiedAt ?? null,
        lastKnownPath: input.rootRelativePath,
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
          lastKnownPath: input.rootRelativePath,
          updatedAt: now,
        },
      })
      .run();
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

  async listEntries(): Promise<LibraryEntryRecord[]> {
    const items = this.database.db.select().from(libraryItems).orderBy(desc(libraryItems.indexedAt)).all();
    const ids = items.map((item) => item.id);
    const [filesByItem, assetsByItem] = await Promise.all([this.listFilesForItems(ids), this.listAssetsForItems(ids)]);
    return items.map((item) =>
      toLibraryEntryRecord(item, filesByItem.get(item.id) ?? [], assetsByItem.get(item.id) ?? []),
    );
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
}

const groupByItem = <TRecord extends { itemId: string }>(records: TRecord[]): Map<string, TRecord[]> => {
  const grouped = new Map<string, TRecord[]>();
  for (const record of records) {
    grouped.set(record.itemId, [...(grouped.get(record.itemId) ?? []), record]);
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

import { randomUUID } from "node:crypto";
import path from "node:path";
import { and, desc, eq, inArray, isNotNull, isNull, or, type SQL, sql } from "drizzle-orm";
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
  scrapeAttempts,
  scrapeItemOutcomes,
  scrapeRunItems,
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
  createdAt?: Date;
  lastRefreshedAt?: Date | null;
}

export interface LibraryFileInput {
  fileId?: string;
  rootId: string;
  rootRelativePath: string;
  size?: number;
  modifiedAt?: Date | null;
  sourceOutcomeId?: string | null;
  partNumber?: number | null;
  partSuffix?: string | null;
  resolution?: string | null;
  assets?: Array<{
    kind: string;
    fileId?: string | null;
    uri: string;
    rootId?: string | null;
    relativePath?: string | null;
    published?: boolean;
  }>;
  lastKnownPath?: string | null;
}

export type UpsertLibraryEntryInput = LibraryMovieInput & LibraryFileInput;

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
  sourceOutcomeId: string | null;
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
  historical: boolean;
  createdAt: Date;
}

export interface CommitMaintenanceRefreshInput {
  files: Array<{
    librarySource?: MaintenanceLibrarySourceRecord;
    sourceAbsolutePath: string;
    targetAbsolutePath: string;
    size: number;
    modifiedAt: Date;
    outputAssets?: Array<{ kind: string; rootId: string; relativePath: string }>;
  }>;
  crawlerData?: MaintenanceCrawlerDataRecord;
  fallbackNumber: string;
  assets: MaintenanceDiscoveredAssetsRecord;
  removedAssets?: Array<{ rootId: string; relativePath: string }>;
  refreshedAt: Date;
}

export interface MaintenanceLibrarySourceRecord {
  files: Array<{ libraryFileId: string; rootId: string; rootRelativePath: string }>;
  nfo?: { rootId: string; relativePath: string };
  strm?: { rootId: string; relativePath: string };
  libraryItemId: string;
  libraryFileId: string;
  rootId: string;
  rootRelativePath: string;
}

export interface MaintenanceCrawlerDataRecord {
  title: string;
  number: string;
  actors: string[];
  thumb_url?: string;
  poster_url?: string;
  fanart_url?: string;
  thumb_source_url?: string;
  poster_source_url?: string;
  fanart_source_url?: string;
  trailer_source_url?: string;
  scene_images: string[];
  trailer_url?: string;
}

export interface MaintenanceDiscoveredAssetsRecord {
  thumb?: string;
  poster?: string;
  fanart?: string;
  sceneImages: string[];
  trailer?: string;
  actorPhotos: string[];
}

export type RootPathCandidate = {
  hostPath: string;
  rootId: string;
  rootRelativePath: string;
};

type MaintenanceAssetInput = {
  kind: string;
  uri: string;
  rootId: string | null;
  relativePath: string | null;
};

export interface PreparedMaintenanceRefresh {
  movie: LibraryMovieInput & { id: string };
  files: Array<{
    librarySource: MaintenanceLibrarySourceRecord | undefined;
    targetCandidates: RootPathCandidate[];
    libraryEntry: LibraryFileInput;
  }>;
}

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
  sourceOutcomeId: row.sourceOutcomeId,
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
  historical: row.historical,
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
    files,
    assets,
  };
};

const isRemoteAssetUri = (value: string): boolean => /^https?:\/\//iu.test(value.trim());

export class LibraryRepository {
  constructor(private readonly database: PersistenceDatabase) {}

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
        .where(
          owners.length
            ? or(assetWhere, and(inArray(libraryItemAssets.itemId, owners), eq(libraryItemAssets.historical, false)))
            : assetWhere,
        )
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
                  historical: asset.historical,
                },
              ]
            : [],
        ),
    };
  }

  registerPublishedOutputs(
    outputs: Array<{ itemId: string; fileId: string | null; kind: string; rootId: string; relativePath: string }>,
  ): void {
    for (const output of outputs) {
      const where = and(
        eq(libraryItemAssets.itemId, output.itemId),
        eq(libraryItemAssets.rootId, output.rootId),
        eq(libraryItemAssets.relativePath, output.relativePath),
        eq(libraryItemAssets.kind, output.kind),
        output.fileId ? eq(libraryItemAssets.fileId, output.fileId) : isNull(libraryItemAssets.fileId),
      );
      const existing = this.database.db.select().from(libraryItemAssets).where(where).get();
      if (existing)
        this.database.db.update(libraryItemAssets).set({ published: true, historical: false }).where(where).run();
      else
        this.database.db
          .insert(libraryItemAssets)
          .values({ ...output, id: randomUUID(), uri: output.relativePath, published: true, createdAt: new Date() })
          .run();
    }
  }

  releaseOutputReferences(
    refs: Array<{ itemId: string; fileId: string | null; kind: string; rootId: string; relativePath: string }>,
  ): void {
    for (const ref of refs)
      this.database.db
        .delete(libraryItemAssets)
        .where(
          and(
            eq(libraryItemAssets.itemId, ref.itemId),
            ref.fileId !== null ? eq(libraryItemAssets.fileId, ref.fileId) : isNull(libraryItemAssets.fileId),
            eq(libraryItemAssets.kind, ref.kind),
            eq(libraryItemAssets.rootId, ref.rootId),
            eq(libraryItemAssets.relativePath, ref.relativePath),
          ),
        )
        .run();
  }

  async upsertEntry(input: UpsertLibraryEntryInput): Promise<LibraryEntryRecord> {
    const transaction = this.database.sqlite.transaction(() => writeLibraryRows(this.database, input, [input]));
    const id = transaction();
    return await this.getEntryById(id);
  }

  async resolveMaintenanceSource(absolutePath: string): Promise<MaintenanceLibrarySourceRecord | null> {
    const matches = this.findLibraryFilesAtAbsolutePath(absolutePath);
    const itemIds = new Set(matches.map(({ file }) => file.itemId));
    if (itemIds.size > 1) {
      throw new Error(`同一实际文件被多个媒体库条目引用：${absolutePath}`);
    }
    const match = matches[0];
    const assets = match ? ((await this.listAssetsForItems([match.file.itemId])).get(match.file.itemId) ?? []) : [];
    const output = (kind: string) => {
      const asset = assets.find(
        (asset) =>
          asset.kind === kind &&
          asset.rootId &&
          asset.relativePath &&
          (asset.fileId === null || asset.fileId === match?.file.id),
      );
      return asset?.rootId && asset.relativePath
        ? { rootId: asset.rootId, relativePath: asset.relativePath }
        : undefined;
    };
    return match
      ? {
          files: this.database.db
            .select()
            .from(libraryItemFiles)
            .where(eq(libraryItemFiles.itemId, match.file.itemId))
            .all()
            .map((file) => ({ libraryFileId: file.id, rootId: file.rootId, rootRelativePath: file.rootRelativePath }))
            .sort((a, b) => a.libraryFileId.localeCompare(b.libraryFileId)),
          nfo: output("nfo"),
          strm: output("strm"),
          libraryItemId: match.file.itemId,
          libraryFileId: match.file.id,
          rootId: match.file.rootId,
          rootRelativePath: match.file.rootRelativePath,
        }
      : null;
  }

  async preflightMaintenanceRefresh(input: {
    librarySource?: MaintenanceLibrarySourceRecord;
    sourceAbsolutePath: string;
    targetAbsolutePath: string;
  }): Promise<void> {
    this.assertMaintenanceSource(input.librarySource);
    if (
      input.librarySource &&
      !this.pathCandidates(input.sourceAbsolutePath).some(
        (candidate) =>
          candidate.rootId === input.librarySource?.rootId &&
          candidate.rootRelativePath === input.librarySource.rootRelativePath,
      )
    ) {
      throw new Error("维护源文件位置已变化，请重新预览");
    }
    const candidates = this.pathCandidates(input.targetAbsolutePath);
    if (candidates.length === 0) {
      throw new Error(`维护目标路径不属于任何已注册媒体目录：${input.targetAbsolutePath}`);
    }
    this.assertNoMaintenanceTargetConflict(candidates, input.librarySource?.libraryItemId);
  }

  async prepareRefresh(input: CommitMaintenanceRefreshInput): Promise<PreparedMaintenanceRefresh> {
    if (input.files.length === 0) throw new Error("维护刷新文件集合不能为空");
    const itemIds = new Set(
      input.files.flatMap((file) => (file.librarySource ? [file.librarySource.libraryItemId] : [])),
    );
    if (itemIds.size > 1) throw new Error("维护刷新文件不属于同一影片");
    const itemId = [...itemIds][0] ?? randomUUID();
    const files = input.files.map((file) => {
      this.assertMaintenanceSource(file.librarySource);
      const targetCandidates = this.pathCandidates(file.targetAbsolutePath);
      if (targetCandidates.length === 0) {
        throw new Error(`维护目标路径不属于任何已注册媒体目录：${file.targetAbsolutePath}`);
      }
      this.assertNoMaintenanceTargetConflict(targetCandidates, file.librarySource?.libraryItemId);
      const target = chooseRootCandidate(targetCandidates, file.librarySource?.rootId);
      const previousFile = file.librarySource
        ? this.database.db
            .select()
            .from(libraryItemFiles)
            .where(eq(libraryItemFiles.id, file.librarySource.libraryFileId))
            .get()
        : undefined;
      return {
        file,
        targetCandidates,
        target,
        previousFile,
        fileId: file.librarySource?.libraryFileId ?? randomUUID(),
      };
    });
    const changedAssets = this.buildMaintenanceAssets(input, files[0]?.target.rootId as string);
    const fileAssets = files.flatMap(({ file, fileId }) =>
      (file.outputAssets ?? []).map((asset) => ({
        ...asset,
        fileId: asset.kind === "strm" || asset.kind === "subtitle" ? fileId : null,
        uri: asset.relativePath,
      })),
    );
    const changedKinds = new Set([
      "thumb",
      "poster",
      "fanart",
      "trailer",
      "scene",
      "actor",
      ...changedAssets.map((asset) => asset.kind),
    ]);
    const removedKeys = new Set((input.removedAssets ?? []).map((asset) => `${asset.rootId}:${asset.relativePath}`));
    const previousAssets = itemIds.size ? ((await this.listAssetsForItems([itemId])).get(itemId) ?? []) : [];
    const assets = [
      ...previousAssets.filter(
        (asset) =>
          !removedKeys.has(`${asset.rootId}:${asset.relativePath}`) &&
          (asset.fileId
            ? !fileAssets.some((replacement) => replacement.fileId === asset.fileId && replacement.kind === asset.kind)
            : !changedKinds.has(asset.kind)),
      ),
      ...changedAssets,
      ...fileAssets,
    ];
    const crawlerDataJson = input.crawlerData ? JSON.stringify(input.crawlerData) : null;
    const mediaIdentity = input.crawlerData?.number?.trim() || input.fallbackNumber.trim() || null;
    const title = input.crawlerData?.title ?? null;
    const number = input.crawlerData?.number ?? input.fallbackNumber ?? null;
    const existingItem = itemIds.size
      ? this.database.db.select().from(libraryItems).where(eq(libraryItems.id, itemId)).limit(1).get()
      : null;
    return {
      movie: {
        id: itemId,
        mediaIdentity,
        title,
        number,
        actors: input.crawlerData?.actors ?? [],
        crawlerDataJson,
        createdAt: existingItem?.createdAt ?? input.refreshedAt,
        lastRefreshedAt: input.refreshedAt,
      },
      files: files.map(({ file, targetCandidates, target, previousFile, fileId }, index) => ({
        librarySource: file.librarySource,
        targetCandidates,
        libraryEntry: {
          fileId,
          partNumber: previousFile?.partNumber,
          partSuffix: previousFile?.partSuffix,
          resolution: previousFile?.resolution,
          rootId: target.rootId,
          rootRelativePath: target.rootRelativePath,
          size: file.size,
          modifiedAt: file.modifiedAt,
          sourceOutcomeId: previousFile?.sourceOutcomeId ?? null,
          ...(index === 0 ? { assets } : {}),
          lastKnownPath: target.rootRelativePath,
        },
      })),
    };
  }

  writeRefresh(prepared: PreparedMaintenanceRefresh): { libraryItemId: string } {
    for (const file of prepared.files) {
      this.assertMaintenanceSource(file.librarySource);
      this.assertNoMaintenanceTargetConflict(file.targetCandidates, file.librarySource?.libraryItemId);
    }
    return this.database.sqlite.transaction(() => {
      writeLibraryRows(
        this.database,
        prepared.movie,
        prepared.files.map((file) => file.libraryEntry),
      );
      return { libraryItemId: prepared.movie.id };
    })();
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
      this.findLibraryFilesAtAbsolutePath(path.resolve(root.hostPath, input.rootRelativePath)).some(
        (match) => match.file.id !== file.id,
      )
    )
      throw new Error("重定位目标实际路径已属于另一个文件");
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

  async resolveUncensoredFiles<TChoice extends string>(selections: readonly { outcomeId: string; choice: TChoice }[]) {
    const choices = new Map<string, TChoice>();
    for (const selection of selections) {
      const file = this.database.db
        .select()
        .from(libraryItemFiles)
        .where(eq(libraryItemFiles.sourceOutcomeId, selection.outcomeId))
        .get();
      if (!file) throw new Error("刮削结果已不属于已登记影片文件，请刷新媒体库");
      const previous = choices.get(file.itemId);
      if (previous !== undefined && previous !== selection.choice) throw new Error("同一影片不能选择不同的无码类型");
      choices.set(file.itemId, selection.choice);
    }
    const result = [];
    for (const [itemId, choice] of choices) {
      const entry = await this.getEntryById(itemId);
      for (const file of entry.files) {
        if (!file.sourceOutcomeId) throw new Error(`影片文件缺少刮削来源：${file.rootRelativePath}`);
        const outcome = this.database.db
          .select()
          .from(scrapeItemOutcomes)
          .where(eq(scrapeItemOutcomes.id, file.sourceOutcomeId))
          .get();
        if (!outcome || outcome.outcome !== "success") throw new Error("影片文件刮削来源已失效");
        result.push({ file, choice, outcome, entry });
      }
    }
    return result;
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

  async getEntryBySourceOutcomeId(sourceOutcomeId: string): Promise<LibraryEntryRecord | null> {
    return (await this.getEntriesBySourceOutcomeIds([sourceOutcomeId])).get(sourceOutcomeId) ?? null;
  }

  async getEntriesBySourceOutcomeIds(sourceOutcomeIds: string[]): Promise<Map<string, LibraryEntryRecord>> {
    const ids = [...new Set(sourceOutcomeIds.map((id) => id.trim()).filter(Boolean))];
    if (ids.length === 0) return new Map();
    const sourceFiles = this.database.db
      .select({
        itemId: libraryItemFiles.itemId,
        sourceOutcomeId: libraryItemFiles.sourceOutcomeId,
      })
      .from(libraryItemFiles)
      .where(inArray(libraryItemFiles.sourceOutcomeId, ids))
      .all();
    const itemIds = [...new Set(sourceFiles.map((file) => file.itemId))];
    const items = itemIds.length
      ? this.database.db.select().from(libraryItems).where(inArray(libraryItems.id, itemIds)).all()
      : [];
    const [filesByItem, assetsByItem] = await Promise.all([
      this.listFilesForItems(itemIds),
      this.listAssetsForItems(itemIds),
    ]);
    const entries = new Map<string, LibraryEntryRecord>();
    const itemById = new Map(items.map((item) => [item.id, item]));
    for (const sourceFile of sourceFiles) {
      if (!sourceFile.sourceOutcomeId) continue;
      const item = itemById.get(sourceFile.itemId);
      if (!item) continue;
      entries.set(
        sourceFile.sourceOutcomeId,
        toLibraryEntryRecord(item, filesByItem.get(item.id) ?? [], assetsByItem.get(item.id) ?? []),
      );
    }
    return entries;
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
    return roots
      .flatMap((root): RootPathCandidate[] => {
        const resolvedRootPath = path.resolve(root.hostPath);
        const relative = path.relative(resolvedRootPath, resolvedPath);
        if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
          return [];
        }
        return [
          {
            hostPath: resolvedRootPath,
            rootId: root.id,
            rootRelativePath: relative.replace(/\\/gu, "/"),
          },
        ];
      })
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

  private assertMaintenanceSource(source: MaintenanceLibrarySourceRecord | undefined): void {
    if (!source) return;
    const currentFiles = this.database.db
      .select()
      .from(libraryItemFiles)
      .where(eq(libraryItemFiles.itemId, source.libraryItemId))
      .all();
    if (
      currentFiles.length !== source.files.length ||
      currentFiles.some(
        (file) =>
          !source.files.some(
            (expected) =>
              expected.libraryFileId === file.id &&
              expected.rootId === file.rootId &&
              expected.rootRelativePath === file.rootRelativePath,
          ),
      )
    ) {
      throw new Error("影片文件集合已变化，请重新预览");
    }
    const file = this.database.db
      .select({ id: libraryItemFiles.id })
      .from(libraryItemFiles)
      .where(
        and(
          eq(libraryItemFiles.id, source.libraryFileId),
          eq(libraryItemFiles.itemId, source.libraryItemId),
          eq(libraryItemFiles.rootId, source.rootId),
          eq(libraryItemFiles.rootRelativePath, source.rootRelativePath),
        ),
      )
      .limit(1)
      .get();
    if (!file) throw new Error("原媒体库条目或文件引用已变化，请重新预览");
  }

  private assertNoMaintenanceTargetConflict(
    candidates: readonly RootPathCandidate[],
    allowedItemId: string | undefined,
  ): void {
    for (const candidate of candidates) {
      const occupant = this.database.db
        .select({ itemId: libraryItemFiles.itemId })
        .from(libraryItemFiles)
        .where(
          and(
            eq(libraryItemFiles.rootId, candidate.rootId),
            eq(libraryItemFiles.rootRelativePath, candidate.rootRelativePath),
          ),
        )
        .limit(1)
        .get();
      if (occupant && occupant.itemId !== allowedItemId) {
        throw new Error(
          `维护目标路径已属于另一个媒体库条目 ${occupant.itemId}：${candidate.rootId}:${candidate.rootRelativePath}`,
        );
      }
    }
  }

  private buildMaintenanceAssets(
    input: CommitMaintenanceRefreshInput,
    preferredRootId: string,
  ): MaintenanceAssetInput[] {
    const outputs: MaintenanceAssetInput[] = [];
    const localKinds = new Set<string>();
    const addLocal = (kind: string, value: string | undefined): void => {
      const absolutePath = value?.trim();
      if (!absolutePath) return;
      const candidates = this.pathCandidates(absolutePath);
      if (candidates.length === 0) {
        throw new Error(`维护生成的本地资源不属于任何已注册媒体目录：${absolutePath}`);
      }
      const mapped = chooseRootCandidate(candidates, preferredRootId);
      outputs.push({
        kind,
        uri: mapped.rootRelativePath,
        rootId: mapped.rootId,
        relativePath: mapped.rootRelativePath,
      });
      localKinds.add(kind);
    };

    addLocal("thumb", input.assets.thumb);
    addLocal("poster", input.assets.poster);
    addLocal("fanart", input.assets.fanart);
    addLocal("trailer", input.assets.trailer);
    for (const sceneImage of input.assets.sceneImages) addLocal("scene", sceneImage);
    for (const actorPhoto of input.assets.actorPhotos) addLocal("actor", actorPhoto);

    const addRemoteFallback = (kind: string, values: Array<string | undefined>): void => {
      if (localKinds.has(kind)) return;
      for (const value of values) {
        const uri = value?.trim();
        if (!uri || !isRemoteAssetUri(uri)) continue;
        outputs.push({ kind, uri, rootId: null, relativePath: null });
      }
    };
    const crawlerData = input.crawlerData;
    addRemoteFallback("thumb", [crawlerData?.thumb_source_url, crawlerData?.thumb_url]);
    addRemoteFallback("poster", [crawlerData?.poster_source_url, crawlerData?.poster_url]);
    addRemoteFallback("fanart", [crawlerData?.fanart_source_url, crawlerData?.fanart_url]);
    addRemoteFallback("trailer", [crawlerData?.trailer_source_url, crawlerData?.trailer_url]);
    addRemoteFallback("scene", crawlerData?.scene_images ?? []);
    return outputs;
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
            .select({ file: libraryItemFiles, sourceRunId: scrapeRunItems.runId })
            .from(libraryItemFiles)
            .leftJoin(scrapeItemOutcomes, eq(scrapeItemOutcomes.id, libraryItemFiles.sourceOutcomeId))
            .leftJoin(scrapeAttempts, eq(scrapeAttempts.id, scrapeItemOutcomes.attemptId))
            .leftJoin(scrapeRunItems, eq(scrapeRunItems.id, scrapeAttempts.itemId))
            .where(inArray(libraryItemFiles.itemId, ids))
            .orderBy(libraryItemFiles.createdAt)
            .all()
        : [];
    return groupByItem(rows.map((row) => toLibraryItemFileRecord(row.file, row.sourceRunId)));
  }

  private async listAssetsForItems(ids: string[]): Promise<Map<string, LibraryItemAssetRecord[]>> {
    const rows =
      ids.length > 0
        ? this.database.db
            .select()
            .from(libraryItemAssets)
            .where(and(inArray(libraryItemAssets.itemId, ids), eq(libraryItemAssets.historical, false)))
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

const chooseRootCandidate = (candidates: readonly RootPathCandidate[], preferredRootId?: string): RootPathCandidate => {
  const longest = candidates[0];
  if (!longest) throw new Error("路径不属于任何已注册媒体目录");
  const sameDepth = candidates.filter((candidate) => candidate.hostPath.length === longest.hostPath.length);
  return sameDepth.find((candidate) => candidate.rootId === preferredRootId) ?? longest;
};

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

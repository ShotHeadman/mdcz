import { stat } from "node:fs/promises";
import { resolveRootRelativePath } from "@mdcz/media-store";
import type { LibraryEntryRecord } from "@mdcz/persistence";
import { createRecentAcquisitionsFromEntries, type RuntimeLibraryEntrySummaryInput } from "@mdcz/runtime/library";
import { decodeLibraryPageCursor, encodeLibraryPageCursor } from "@mdcz/shared/libraryPagination";
import type {
  CrawlerDataDto,
  LibraryAvailabilityInput,
  LibraryAvailabilityResponse,
  LibraryDetailResponse,
  LibraryEntryDto,
  LibraryListInput,
  LibraryListResponse,
  MediaRootDto,
  OverviewSummaryResponse,
} from "@mdcz/shared/serverDtos";
import type { ActorProfile } from "@mdcz/shared/types";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";

const toIso = (value: Date | null): string | null => value?.toISOString() ?? null;
const AVAILABILITY_CACHE_TTL_MS = 30_000;
const AVAILABILITY_CONCURRENCY = 8;

export class LibraryService {
  private readonly availabilityCache = new Map<string, { available: boolean; expiresAt: number }>();

  constructor(
    private readonly persistence: ServerPersistenceService,
    private readonly mediaRoots: MediaRootService,
  ) {}

  async list(input: LibraryListInput = {}): Promise<LibraryListResponse> {
    return await this.listDtos(input);
  }

  /**
   * Every distinct actor profile in the library, keyed by case-insensitive name — first occurrence wins.
   * Reads only the crawler payload column: the file/asset joins a full listing does are pure overhead here.
   * Parsing lives in this layer because `@mdcz/persistence` cannot depend on the shared domain types.
   */
  async listActorProfiles(): Promise<ActorProfile[]> {
    const state = await this.persistence.getState();
    const payloads = await state.repositories.library.listCrawlerDataJson();
    const profiles = new Map<string, ActorProfile>();
    for (const payload of payloads) {
      for (const profile of parseCrawlerData(payload)?.actor_profiles ?? []) {
        const key = profile.name?.trim().toLowerCase();
        if (key && !profiles.has(key)) {
          profiles.set(key, profile);
        }
      }
    }
    return [...profiles.values()];
  }

  async detail(id: string): Promise<LibraryDetailResponse> {
    const state = await this.persistence.getState();
    const [entry, rootMap] = await Promise.all([state.repositories.library.getEntryById(id), this.loadRootMap()]);
    return { entry: await this.toDto(entry, rootMap, true) };
  }

  async refresh(id: string): Promise<LibraryDetailResponse> {
    const state = await this.persistence.getState();
    const [entry, rootMap] = await Promise.all([state.repositories.library.touchEntry(id), this.loadRootMap()]);
    return { entry: await this.toDto(entry, rootMap, true) };
  }

  async relink(input: { id: string; rootId: string; relativePath: string }): Promise<LibraryDetailResponse> {
    await this.mediaRoots.getActiveRoot(input.rootId);
    const state = await this.persistence.getState();
    const entry = await state.repositories.library.relinkEntry({
      id: input.id,
      rootId: input.rootId,
      rootRelativePath: input.relativePath,
    });
    return { entry: await this.toDto(entry, await this.loadRootMap(), true) };
  }

  async availability(input: LibraryAvailabilityInput): Promise<LibraryAvailabilityResponse> {
    const state = await this.persistence.getState();
    const [records, rootMap] = await Promise.all([
      state.repositories.library.getAvailabilityEntriesByIds(input.ids),
      this.loadRootMap(),
    ]);
    const paths = new Map<string, { root: MediaRootDto; relativePath: string }>();
    for (const entry of records) {
      const root = rootMap.get(entry.rootId);
      if (root) {
        paths.set(availabilityKey(root, entry.rootRelativePath), { root, relativePath: entry.rootRelativePath });
      }
      for (const file of entry.files) {
        const fileRoot = rootMap.get(file.rootId);
        if (fileRoot) {
          paths.set(availabilityKey(fileRoot, file.rootRelativePath), {
            root: fileRoot,
            relativePath: file.rootRelativePath,
          });
        }
      }
    }
    const availability = new Map(
      await mapWithConcurrency([...paths.entries()], AVAILABILITY_CONCURRENCY, async ([key, path]) => [
        key,
        await this.checkAvailability(path.root, path.relativePath),
      ]),
    );
    const resolveAvailability = (root: MediaRootDto | undefined, relativePath: string): boolean | null =>
      root ? (availability.get(availabilityKey(root, relativePath)) ?? false) : null;

    return {
      entries: records.map((entry) => ({
        id: entry.id,
        available: resolveAvailability(rootMap.get(entry.rootId), entry.rootRelativePath),
        fileRefs: entry.files.map((file) => ({
          id: file.id,
          available: resolveAvailability(rootMap.get(file.rootId), file.rootRelativePath),
        })),
      })),
    };
  }

  async removeRecentAcquisition(id: string): Promise<{ success: true }> {
    const normalizedId = id.trim();
    if (!normalizedId) {
      throw new Error("Library entry id is required");
    }
    const state = await this.persistence.getState();
    await state.repositories.library.hideFromRecent(normalizedId);
    return { success: true };
  }

  async deleteEntry(id: string): Promise<{ success: true }> {
    const normalizedId = id.trim();
    if (!normalizedId) {
      throw new Error("Library entry id is required");
    }
    const state = await this.persistence.getState();
    await state.repositories.library.deleteEntry(normalizedId);
    return { success: true };
  }

  async overview(): Promise<OverviewSummaryResponse> {
    const state = await this.persistence.getState();
    const [latestOutput, roots, summary] = await Promise.all([
      state.repositories.library.latestScrapeOutput(),
      this.mediaRoots.list(),
      state.repositories.library.getOverviewSummary(8),
    ]);
    const rootMap = new Map(roots.roots.map((root) => [root.id, root]));
    const entries = summary.recentEntries.filter((entry) => rootMap.has(entry.rootId));
    const runtimeEntries = entries.map(toRuntimeLibraryEntrySummaryInput);
    const recent = createRecentAcquisitionsFromEntries(runtimeEntries, 8);
    const latestEntryTimestamp = summary.latestEntryTimestamp
      ? summary.latestEntryTimestamp instanceof Date
        ? summary.latestEntryTimestamp
        : new Date(Number(summary.latestEntryTimestamp))
      : null;
    const output = latestOutput
      ? {
          fileCount: latestOutput.fileCount,
          totalBytes: latestOutput.totalBytes,
          outputAt: latestOutput.completedAt.toISOString(),
          rootPath: latestOutput.outputDirectory,
        }
      : {
          fileCount: summary.fileCount,
          totalBytes: summary.totalBytes,
          outputAt: latestEntryTimestamp?.toISOString() ?? null,
          rootPath: null,
        };
    const recentAcquisitions = await Promise.all(
      recent.map(async (entry) => {
        const record = entries.find((candidate) => candidate.id === entry.id);
        const root = record ? rootMap.get(record.rootId) : undefined;
        return {
          id: entry.id ?? "",
          rootId: record?.rootId ?? "",
          number: entry.number,
          title: entry.title,
          actors: entry.actors,
          thumbnailPath: entry.thumbnailPath ?? null,
          lastKnownPath: entry.lastKnownPath,
          completedAt: new Date(entry.completedAt).toISOString(),
          available: record && root ? await this.checkAvailability(root, record.rootRelativePath) : null,
        };
      }),
    );

    return {
      output: {
        fileCount: output.fileCount,
        totalBytes: output.totalBytes,
        outputAt: output.outputAt,
        rootPath: output.rootPath,
      },
      recentAcquisitions,
    };
  }

  private async listDtos(input: LibraryListInput = {}): Promise<LibraryListResponse> {
    const state = await this.persistence.getState();
    const [rootMap, page] = await Promise.all([
      this.loadRootMap(),
      state.repositories.library.listEntriesPage({
        cursor: decodeLibraryPageCursor(input?.cursor),
        limit: input?.limit ?? 100,
        query: input?.query,
        rootId: input?.rootId,
      }),
    ]);

    return {
      entries: await Promise.all(
        page.entries.filter((entry) => rootMap.has(entry.rootId)).map((entry) => this.toDto(entry, rootMap, false)),
      ),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor ? encodeLibraryPageCursor(page.nextCursor) : null,
      total: page.total,
    };
  }

  private async toDto(
    entry: LibraryEntryRecord,
    rootMap: ReadonlyMap<string, MediaRootDto>,
    includeAvailability: boolean,
  ): Promise<LibraryEntryDto> {
    const root = rootMap.get(entry.rootId);
    if (!root) {
      throw new Error(`Media root not found: ${entry.rootId}`);
    }
    const available = includeAvailability ? await this.checkAvailability(root, entry.rootRelativePath) : null;
    const fileRefs = await Promise.all(
      entry.files.map(async (file) => {
        const fileRoot = rootMap.get(file.rootId);
        const fileAvailable =
          includeAvailability && fileRoot ? await this.checkAvailability(fileRoot, file.rootRelativePath) : null;
        return {
          id: file.id,
          rootId: file.rootId,
          rootDisplayName: fileRoot?.displayName ?? "未知媒体目录",
          relativePath: file.rootRelativePath,
          fileName: file.fileName,
          directory: file.directory,
          size: file.size,
          modifiedAt: toIso(file.modifiedAt),
          lastKnownPath: file.lastKnownPath,
          available: fileAvailable,
        };
      }),
    );

    return {
      id: entry.id,
      mediaIdentity: entry.mediaIdentity,
      rootId: entry.rootId,
      rootDisplayName: root.displayName,
      relativePath: entry.rootRelativePath,
      fileName: entry.fileName,
      directory: entry.directory,
      size: entry.size,
      modifiedAt: toIso(entry.modifiedAt),
      taskId: entry.sourceTaskId,
      scrapeOutputId: entry.scrapeOutputId,
      title: entry.title,
      number: entry.number,
      actors: entry.actors,
      crawlerData: parseCrawlerData(entry.crawlerDataJson),
      thumbnailPath: entry.thumbnailPath,
      lastKnownPath: entry.lastKnownPath,
      createdAt: entry.createdAt.toISOString(),
      lastRefreshedAt: toIso(entry.lastRefreshedAt),
      hiddenFromRecentAt: toIso(entry.hiddenFromRecentAt),
      available,
      fileRefs,
      assets: entry.assets.map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        uri: asset.uri,
        rootId: asset.rootId,
        relativePath: asset.relativePath,
      })),
    };
  }

  private async loadRootMap(): Promise<Map<string, MediaRootDto>> {
    const roots = await this.mediaRoots.list();
    return new Map(roots.roots.map((root) => [root.id, root]));
  }

  private async checkAvailability(
    root: { hostPath: string; enabled: boolean },
    relativePath: string,
  ): Promise<boolean> {
    if (!root.enabled) {
      return false;
    }
    const key = availabilityKey(root, relativePath);
    const cached = this.availabilityCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.available;
    }
    let available = false;
    try {
      const stats = await stat(resolveRootRelativePath(root, relativePath));
      available = stats.isFile();
    } catch {
      available = false;
    }
    this.availabilityCache.set(key, { available, expiresAt: Date.now() + AVAILABILITY_CACHE_TTL_MS });
    return available;
  }
}

const availabilityKey = (root: { hostPath: string }, relativePath: string): string =>
  `${root.hostPath}\u0000${relativePath}`;

const mapWithConcurrency = async <TItem, TResult>(
  items: readonly TItem[],
  concurrency: number,
  mapper: (item: TItem) => Promise<TResult>,
): Promise<TResult[]> => {
  const outputs = new Array<TResult>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      outputs[index] = await mapper(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return outputs;
};

const parseCrawlerData = (value: string | null): CrawlerDataDto | null => {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as CrawlerDataDto;
  } catch {
    return null;
  }
};

const toRuntimeLibraryEntrySummaryInput = (
  entry: Pick<
    LibraryEntryRecord,
    | "actors"
    | "createdAt"
    | "fileName"
    | "hiddenFromRecentAt"
    | "id"
    | "lastKnownPath"
    | "number"
    | "size"
    | "thumbnailPath"
    | "title"
  >,
): RuntimeLibraryEntrySummaryInput => ({
  id: entry.id,
  number: entry.number,
  fileName: entry.fileName,
  title: entry.title,
  actors: entry.actors,
  thumbnailPath: entry.thumbnailPath,
  lastKnownPath: entry.lastKnownPath,
  createdAt: entry.createdAt,
  hiddenFromRecentAt: entry.hiddenFromRecentAt,
  size: entry.size,
});

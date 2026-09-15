import type { LibraryEntryRecord } from "@mdcz/persistence";
import {
  createRecentAcquisitionsFromEntries,
  LibraryAvailabilityChecker,
  parseLibraryCrawlerData,
  relinkLibraryFile,
  toLibraryEntryDto,
} from "@mdcz/runtime/library";
import { libraryAvailability } from "@mdcz/shared/libraryAvailability";
import { decodeLibraryPageCursor, encodeLibraryPageCursor } from "@mdcz/shared/libraryPagination";
import type {
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

export class LibraryService {
  private readonly availabilityChecker = new LibraryAvailabilityChecker();

  constructor(
    private readonly persistence: ServerPersistenceService,
    private readonly mediaRoots: MediaRootService,
  ) {}

  async list(input: LibraryListInput = {}): Promise<LibraryListResponse> {
    return await this.listDtos(input);
  }

  async removeFile(input: { fileId: string }): Promise<{ success: true }> {
    (await this.persistence.getState()).repositories.library.removeFile(input.fileId);
    return { success: true };
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
      for (const profile of parseLibraryCrawlerData(payload)?.actor_profiles ?? []) {
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

  async relink(input: { fileId: string; rootId: string; relativePath: string }): Promise<LibraryDetailResponse> {
    const root = await this.mediaRoots.get(input.rootId);
    const state = await this.persistence.getState();
    const current = await state.repositories.library.getEntryByFileId(input.fileId);
    const entry = await relinkLibraryFile({
      ...input,
      root,
      files: current.files,
      resolveRoot: (id) => this.mediaRoots.get(id),
      relink: (file) => state.repositories.library.relinkFile(file),
    });
    return { entry: await this.toDto(entry, await this.loadRootMap(), true) };
  }

  async availability(input: LibraryAvailabilityInput): Promise<LibraryAvailabilityResponse> {
    const state = await this.persistence.getState();
    const [records, rootMap] = await Promise.all([
      state.repositories.library.getAvailabilityEntriesByIds(input.ids),
      this.loadRootMap(),
    ]);
    return await this.availabilityChecker.entries(records, rootMap);
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
    state.repositories.library.deleteEntry(normalizedId);
    return { success: true };
  }

  async overview(): Promise<OverviewSummaryResponse> {
    const state = await this.persistence.getState();
    const [latestRun, roots, summary] = await Promise.all([
      state.repositories.scrapeRuns.getLatestFinalized(),
      this.mediaRoots.list(),
      state.repositories.library.getOverviewSummary(8),
    ]);
    const latestOutput = latestRun ? state.repositories.scrapeRuns.summary(latestRun) : null;
    const rootMap = new Map(roots.roots.map((root) => [root.id, root]));
    const entries = summary.recentEntries.filter((entry) => rootMap.has(entry.rootId));
    const recent = createRecentAcquisitionsFromEntries(entries, 8);
    const latestEntryTimestamp = summary.latestEntryTimestamp
      ? summary.latestEntryTimestamp instanceof Date
        ? summary.latestEntryTimestamp
        : new Date(Number(summary.latestEntryTimestamp))
      : null;
    const output = latestOutput
      ? {
          fileCount: latestOutput.successCount,
          totalBytes: latestOutput.totalBytes,
          outputAt: latestOutput.completedAt.toISOString(),
          rootPath: latestOutput.outputRootId ? (rootMap.get(latestOutput.outputRootId)?.hostPath ?? null) : null,
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
          thumbnailRootId: record?.thumbnailRootId ?? null,
          lastKnownPath: entry.lastKnownPath,
          completedAt: new Date(entry.completedAt).toISOString(),
          available: record && root ? await this.availabilityChecker.check(root, record.rootRelativePath) : null,
        };
      }),
    );

    return {
      output: {
        fileCount: output.fileCount,
        totalBytes: output.totalBytes,
        outputAt: output.outputAt,
        rootPath: output.rootPath,
        unresolvedRepairCount: state.repositories.libraryRepairIssues.countUnresolved(),
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
        page.entries
          .filter((entry) => entry.files.some((file) => file.id === entry.displayFileId && rootMap.has(file.rootId)))
          .map((entry) => this.toDto(entry, rootMap, false)),
      ),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor ? encodeLibraryPageCursor(page.nextCursor) : null,
      total: page.total,
      fileCount: page.fileCount,
      totalBytes: page.totalBytes,
    };
  }

  private async toDto(
    entry: LibraryEntryRecord,
    rootMap: ReadonlyMap<string, MediaRootDto>,
    includeAvailability: boolean,
  ): Promise<LibraryEntryDto> {
    const displayFile = entry.files.find((file) => file.id === entry.displayFileId);
    const root = displayFile && rootMap.get(displayFile.rootId);
    if (!root) {
      throw new Error(`Media root not found for library item: ${entry.id}`);
    }
    const dto = toLibraryEntryDto(entry, rootMap);
    if (!includeAvailability) return dto;
    await Promise.all(
      dto.fileRefs.map(async (file) => {
        const fileRoot = rootMap.get(file.rootId);
        if (!fileRoot) return;
        file.available = await this.availabilityChecker.check(fileRoot, file.relativePath);
        file.availabilityError = this.availabilityChecker.error(fileRoot, file.relativePath);
      }),
    );
    dto.available = libraryAvailability(dto.fileRefs);
    return dto;
  }

  private async loadRootMap(): Promise<Map<string, MediaRootDto>> {
    const roots = await this.mediaRoots.list();
    return new Map(roots.roots.map((root) => [root.id, root]));
  }
}

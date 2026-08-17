import { rm, stat } from "node:fs/promises";
import type { DesktopPersistenceService } from "@main/services/persistence";
import type { MediaRoot } from "@mdcz/media-store";
import { resolveRootRelativePath } from "@mdcz/media-store";
import type { LibraryEntryRecord } from "@mdcz/persistence";
import { DESKTOP_OUTPUT_ROOT_DISPLAY_NAME, DESKTOP_OUTPUT_ROOT_ID } from "@mdcz/runtime/library";
import { decodeLibraryPageCursor, encodeLibraryPageCursor } from "@mdcz/shared/libraryPagination";
import type {
  CrawlerDataDto,
  LibraryAvailabilityInput,
  LibraryAvailabilityResponse,
  LibraryEntryDto,
  LibraryListInput,
  LibraryListResponse,
} from "@mdcz/shared/serverDtos";

const toIso = (value: Date | null): string | null => value?.toISOString() ?? null;

export class DesktopLibraryService {
  constructor(private readonly persistenceService: DesktopPersistenceService) {}

  async list(input: LibraryListInput = {}): Promise<LibraryListResponse> {
    const state = await this.persistenceService.getState();
    const [roots, page] = await Promise.all([
      state.repositories.mediaRoots.list(),
      state.repositories.library.listEntriesPage({
        cursor: decodeLibraryPageCursor(input?.cursor),
        limit: input?.limit ?? 100,
        query: input?.query,
        rootId: input?.rootId,
      }),
    ]);
    const rootMap = new Map(roots.map((root) => [root.id, root]));

    return {
      entries: await Promise.all(page.entries.map((entry) => this.toDto(entry, rootMap, false))),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor ? encodeLibraryPageCursor(page.nextCursor) : null,
      total: page.total,
    };
  }

  async availability(input: LibraryAvailabilityInput): Promise<LibraryAvailabilityResponse> {
    const state = await this.persistenceService.getState();
    const [roots, records] = await Promise.all([
      state.repositories.mediaRoots.list(),
      state.repositories.library.getEntriesByIds(input.ids),
    ]);
    const rootMap = new Map(roots.map((root) => [root.id, root]));
    const checks = new Map<string, Promise<boolean>>();
    const check = (root: MediaRoot | undefined, relativePath: string): Promise<boolean> | null => {
      if (!root) {
        return null;
      }
      const key = `${root.id}:${relativePath}`;
      const existing = checks.get(key);
      if (existing) {
        return existing;
      }
      const pending = this.checkAvailability(root, relativePath);
      checks.set(key, pending);
      return pending;
    };

    return {
      entries: await Promise.all(
        records.map(async (entry) => ({
          id: entry.id,
          available: await check(rootMap.get(entry.rootId), entry.rootRelativePath),
          fileRefs: await Promise.all(
            entry.files.map(async (file) => ({
              id: file.id,
              available: await check(rootMap.get(file.rootId), file.rootRelativePath),
            })),
          ),
        })),
      ),
    };
  }

  async removeRecentAcquisition(id: string): Promise<{ success: true }> {
    const normalizedId = id.trim();
    if (!normalizedId) {
      throw new Error("Library entry id is required");
    }
    const state = await this.persistenceService.getState();
    await state.repositories.library.hideFromRecent(normalizedId);
    return { success: true };
  }

  async deleteEntry(id: string, options: { deleteMediaFiles?: boolean } = {}): Promise<{ success: true }> {
    const normalizedId = id.trim();
    if (!normalizedId) {
      throw new Error("Library entry id is required");
    }
    const state = await this.persistenceService.getState();
    if (options.deleteMediaFiles) {
      const [roots, entry] = await Promise.all([
        state.repositories.mediaRoots.list(),
        state.repositories.library.getEntryById(normalizedId),
      ]);
      const rootMap = new Map(roots.map((root) => [root.id, root]));
      const filePaths = new Set(
        entry.files
          .map((file) => resolveAssetDisplayPath(rootMap, file.rootId, file.lastKnownPath ?? file.rootRelativePath))
          .filter((filePath): filePath is string => typeof filePath === "string" && !isRemotePath(filePath)),
      );
      for (const filePath of filePaths) {
        await rm(filePath, { force: true });
      }
    }
    await state.repositories.library.deleteEntry(normalizedId);
    return { success: true };
  }

  private async toDto(
    entry: LibraryEntryRecord,
    rootMap: Map<string, MediaRoot>,
    includeAvailability: boolean,
  ): Promise<LibraryEntryDto> {
    const root = rootMap.get(entry.rootId);
    const available = includeAvailability && root ? await this.checkAvailability(root, entry.rootRelativePath) : null;
    const fileRefs = await Promise.all(
      entry.files.map(async (file) => {
        const fileRoot = rootMap.get(file.rootId);
        const fileAvailable =
          includeAvailability && fileRoot ? await this.checkAvailability(fileRoot, file.rootRelativePath) : null;
        return {
          id: file.id,
          rootId: file.rootId,
          rootDisplayName: fileRoot?.displayName ?? fallbackRootDisplayName(file.rootId),
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
      rootDisplayName: resolveRootDisplayName(root, entry.rootId),
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
      thumbnailPath: resolveAssetDisplayPath(rootMap, entry.rootId, entry.thumbnailPath),
      lastKnownPath: resolveAssetDisplayPath(rootMap, entry.rootId, entry.lastKnownPath),
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

  private async checkAvailability(
    root: { hostPath: string; enabled: boolean },
    relativePath: string,
  ): Promise<boolean> {
    if (!root.enabled) {
      return false;
    }
    try {
      const stats = await stat(resolveRootRelativePath(root, relativePath));
      return stats.isFile();
    } catch {
      return false;
    }
  }
}

const fallbackRootDisplayName = (rootId: string): string =>
  rootId === DESKTOP_OUTPUT_ROOT_ID ? DESKTOP_OUTPUT_ROOT_DISPLAY_NAME : "输出目录";

const resolveRootDisplayName = (root: MediaRoot | undefined, rootId: string): string => {
  if (rootId === DESKTOP_OUTPUT_ROOT_ID) {
    return root?.hostPath ?? fallbackRootDisplayName(rootId);
  }
  return root?.displayName ?? fallbackRootDisplayName(rootId);
};

const isRemotePath = (value: string): boolean => /^https?:\/\//iu.test(value.trim());

const isAbsoluteLocalPath = (value: string): boolean =>
  /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("/") || value.startsWith("\\\\") || value.startsWith("//");

const resolveAssetDisplayPath = (
  rootMap: ReadonlyMap<string, MediaRoot>,
  rootId: string,
  value: string | null | undefined,
): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  if (isRemotePath(trimmed) || isAbsoluteLocalPath(trimmed)) {
    return trimmed;
  }

  const root = rootMap.get(rootId);
  return root ? resolveRootRelativePath(root, trimmed) : trimmed;
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

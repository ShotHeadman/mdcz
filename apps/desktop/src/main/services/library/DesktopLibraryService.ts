import type { DesktopPersistenceService } from "@main/services/persistence";
import type { MediaRoot } from "@mdcz/media-store";
import { toRootRelativePath } from "@mdcz/media-store";
import type { LibraryEntryRecord } from "@mdcz/persistence";
import {
  DESKTOP_OUTPUT_ROOT_DISPLAY_NAME,
  DESKTOP_OUTPUT_ROOT_ID,
  LibraryAvailabilityChecker,
  relinkLibraryFile,
  toLibraryEntryDto,
} from "@mdcz/runtime/library";
import { decodeLibraryPageCursor, encodeLibraryPageCursor } from "@mdcz/shared/libraryPagination";
import type {
  LibraryAvailabilityInput,
  LibraryAvailabilityResponse,
  LibraryEntryDto,
  LibraryListInput,
  LibraryListResponse,
} from "@mdcz/shared/serverDtos";

export class DesktopLibraryService {
  private readonly availabilityChecker = new LibraryAvailabilityChecker();

  constructor(private readonly persistenceService: DesktopPersistenceService) {}

  async removeFile(input: { fileId: string }): Promise<{ success: true }> {
    (await this.persistenceService.getState()).repositories.library.removeFile(input.fileId);
    return { success: true };
  }

  async relinkFile(input: import("@mdcz/shared/serverDtos").LibraryRelinkInput): Promise<{ success: true }> {
    const { repositories } = await this.persistenceService.getState();
    const root = await repositories.mediaRoots.get(input.rootId);
    const current = await repositories.library.getEntryByFileId(input.fileId);
    await relinkLibraryFile({
      ...input,
      root,
      files: current.files,
      relink: (file) => repositories.library.relinkFile(file),
    });
    return { success: true };
  }

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
      entries: page.entries.map((entry) => this.toDto(entry, rootMap)),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor ? encodeLibraryPageCursor(page.nextCursor) : null,
      total: page.total,
      fileCount: page.fileCount,
      totalBytes: page.totalBytes,
    };
  }

  async availability(input: LibraryAvailabilityInput): Promise<LibraryAvailabilityResponse> {
    const state = await this.persistenceService.getState();
    const [roots, records] = await Promise.all([
      state.repositories.mediaRoots.list(),
      state.repositories.library.getAvailabilityEntriesByIds(input.ids),
    ]);
    return await this.availabilityChecker.entries(records, new Map(roots.map((root) => [root.id, root])));
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

  async deleteEntry(id: string): Promise<{ success: true }> {
    const normalizedId = id.trim();
    if (!normalizedId) {
      throw new Error("Library entry id is required");
    }
    const state = await this.persistenceService.getState();
    state.repositories.library.deleteEntry(normalizedId);
    return { success: true };
  }

  private toDto(entry: LibraryEntryRecord, rootMap: Map<string, MediaRoot>): LibraryEntryDto {
    const displayFile = entry.files.find((file) => file.id === entry.displayFileId);
    if (!displayFile) throw new Error(`Library display file not found: ${entry.id}`);
    const dto = toLibraryEntryDto(entry, rootMap);
    for (const file of dto.fileRefs) {
      file.rootDisplayName = resolveRootDisplayName(rootMap.get(file.rootId), file.rootId);
    }
    dto.thumbnailPath = resolveAssetDisplayPath(
      rootMap,
      entry.thumbnailRootId ?? displayFile.rootId,
      entry.thumbnailPath,
    );
    return dto;
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
  if (isRemotePath(trimmed)) {
    return trimmed;
  }

  const root = rootMap.get(rootId);
  if (isAbsoluteLocalPath(trimmed)) {
    if (!root) {
      return null;
    }
    try {
      return toRootRelativePath(root, trimmed);
    } catch {
      return null;
    }
  }
  return trimmed;
};

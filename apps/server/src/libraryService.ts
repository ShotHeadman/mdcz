import { stat } from "node:fs/promises";
import type { LibraryEntryRecord } from "@mdcz/persistence";
import type {
  CrawlerDataDto,
  LibraryDetailResponse,
  LibraryEntryDto,
  LibraryListInput,
  LibraryListResponse,
  OverviewSummaryResponse,
} from "@mdcz/shared/serverDtos";
import { resolveRootRelativePath } from "@mdcz/storage";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";

const toIso = (value: Date | null): string | null => value?.toISOString() ?? null;

export class LibraryService {
  constructor(
    private readonly persistence: ServerPersistenceService,
    private readonly mediaRoots: MediaRootService,
  ) {}

  async list(input: LibraryListInput = {}): Promise<LibraryListResponse> {
    const entries = await this.listDtos(input, true);
    return { entries: entries.entries, total: entries.total };
  }

  async search(input: LibraryListInput = {}): Promise<LibraryListResponse> {
    return await this.list(input);
  }

  async detail(id: string): Promise<LibraryDetailResponse> {
    const state = await this.persistence.getState();
    const entry = await state.repositories.library.getEntryById(id);
    return { entry: await this.toDto(entry, true) };
  }

  async refresh(id: string): Promise<LibraryDetailResponse> {
    const state = await this.persistence.getState();
    const entry = await state.repositories.library.touchEntry(id);
    return { entry: await this.toDto(entry, true) };
  }

  async relink(input: { id: string; rootId: string; relativePath: string }): Promise<LibraryDetailResponse> {
    await this.mediaRoots.getActiveRoot(input.rootId);
    const state = await this.persistence.getState();
    const entry = await state.repositories.library.relinkEntry({
      id: input.id,
      rootId: input.rootId,
      rootRelativePath: input.relativePath,
    });
    return { entry: await this.toDto(entry, true) };
  }

  async overview(): Promise<OverviewSummaryResponse> {
    const state = await this.persistence.getState();
    const latestOutput = await state.repositories.library.latestScrapeOutput();
    const { entries } = await this.listDtos({ limit: 8 }, true);
    const fallbackOutput = entries.reduce(
      (summary, entry) => ({
        fileCount: summary.fileCount + 1,
        totalBytes: summary.totalBytes + entry.size,
        outputAt: summary.outputAt && summary.outputAt > entry.indexedAt ? summary.outputAt : entry.indexedAt,
        rootPath: null,
      }),
      { fileCount: 0, totalBytes: 0, outputAt: null as string | null, rootPath: null as string | null },
    );

    return {
      output: latestOutput
        ? {
            fileCount: latestOutput.fileCount,
            totalBytes: latestOutput.totalBytes,
            outputAt: latestOutput.completedAt.toISOString(),
            rootPath: latestOutput.outputDirectory,
          }
        : fallbackOutput,
      recentAcquisitions: entries.map((entry) => ({
        id: entry.id,
        number: entry.number ?? entry.fileName,
        title: entry.title ?? entry.fileName,
        actors: entry.actors,
        thumbnailPath: entry.thumbnailPath,
        lastKnownPath: entry.lastKnownPath,
        completedAt: entry.indexedAt,
        available: entry.available,
      })),
    };
  }

  private async listDtos(input: LibraryListInput = {}, includeAvailability: boolean): Promise<LibraryListResponse> {
    const state = await this.persistence.getState();
    const [roots, records] = await Promise.all([this.mediaRoots.list(), state.repositories.library.listEntries()]);
    const rootMap = new Map(roots.roots.map((root) => [root.id, root]));
    const query = input?.query?.trim().toLowerCase() ?? "";
    const rootId = input?.rootId?.trim();
    const limit = input?.limit ?? 200;

    const filtered = records
      .filter((entry) => !rootId || entry.rootId === rootId || entry.files.some((file) => file.rootId === rootId))
      .filter((entry) => {
        const root = rootMap.get(entry.rootId);
        if (!root) {
          return false;
        }
        if (!query) {
          return true;
        }
        return [
          entry.fileName,
          entry.rootRelativePath,
          root.displayName,
          entry.title,
          entry.number,
          entry.mediaIdentity,
          ...entry.actors,
        ]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLowerCase().includes(query));
      });

    return {
      entries: await Promise.all(filtered.slice(0, limit).map((entry) => this.toDto(entry, includeAvailability))),
      total: filtered.length,
    };
  }

  private async toDto(entry: LibraryEntryRecord, includeAvailability: boolean): Promise<LibraryEntryDto> {
    const roots = await this.mediaRoots.list();
    const rootMap = new Map(roots.roots.map((root) => [root.id, root]));
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
      indexedAt: entry.indexedAt.toISOString(),
      lastRefreshedAt: toIso(entry.lastRefreshedAt),
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

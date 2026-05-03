import { stat } from "node:fs/promises";
import type {
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

  async detail(id: string): Promise<LibraryDetailResponse> {
    const { entries } = await this.listDtos({}, true);
    const entry = entries.find((item) => item.id === id);
    if (!entry) {
      throw new Error(`Library entry not found: ${id}`);
    }
    return { entry };
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
      .filter((entry) => !rootId || entry.rootId === rootId)
      .filter((entry) => {
        const root = rootMap.get(entry.rootId);
        if (!root) {
          return false;
        }
        if (!query) {
          return true;
        }
        return [entry.fileName, entry.rootRelativePath, root.displayName, entry.title, entry.number]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLowerCase().includes(query));
      });

    const entries = await Promise.all(
      filtered.slice(0, limit).map(async (entry) => {
        const root = rootMap.get(entry.rootId);
        if (!root) {
          throw new Error(`Media root not found: ${entry.rootId}`);
        }
        const available = includeAvailability ? await this.checkAvailability(root, entry.rootRelativePath) : null;
        return {
          id: entry.id,
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
          thumbnailPath: entry.thumbnailPath,
          lastKnownPath: entry.lastKnownPath,
          indexedAt: entry.indexedAt.toISOString(),
          available,
        } satisfies LibraryEntryDto;
      }),
    );

    return { entries, total: filtered.length };
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

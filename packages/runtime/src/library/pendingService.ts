import path from "node:path";
import { resolveRootRelativePath } from "@mdcz/media-store";
import type {
  LibraryRepository,
  MediaLibraryRepository,
  PendingItemRecord,
  PendingRepository,
  SiteResultRepository,
} from "@mdcz/persistence";
import type { Configuration, DeepPartial } from "@mdcz/shared/config";
import {
  type AmbiguousCandidate,
  ambiguousCandidateSchema,
  type PendingConfirmUncensoredInput,
  type PendingDetailResponse,
  type PendingItemDto,
  type PendingListResponse,
  type PendingRetryInput,
  type PendingRetryResponse,
  pendingSiteResultSchema,
} from "@mdcz/shared/pending";
import type { ScrapeStartInput } from "@mdcz/shared/serverDtos";
import { z } from "zod";
import type { MaintenanceRuntime } from "../maintenance/MaintenanceRuntime";
import { committedMovieRows } from "../publication/committedMovie";
import { toMediaLibrary, toPublicationTarget } from "./mediaLibraryService";
import type { ConfiguredMediaRootService } from "./mediaRootService";

export interface PendingServiceRepositories {
  pending: PendingRepository;
  mediaLibraries: MediaLibraryRepository;
  siteResults: SiteResultRepository;
  library: LibraryRepository;
}

export interface PendingServiceDependencies {
  repositories: () => Promise<PendingServiceRepositories>;
  mediaRoots: ConfiguredMediaRootService;
  startScrape: (input: ScrapeStartInput) => Promise<{ taskId: string }>;
  getConfiguration: () => Promise<Configuration>;
  updateConfiguration: (patch: DeepPartial<Configuration>) => Promise<unknown>;
  maintenanceRuntime: Pick<MaintenanceRuntime, "applyLibraryEntry">;
  onChanged?: () => void;
}

const candidatesSchema = z.array(ambiguousCandidateSchema);

export class PendingService {
  constructor(private readonly deps: PendingServiceDependencies) {}

  async list(): Promise<PendingListResponse> {
    const repositories = await this.deps.repositories();
    const roots = new Map((await this.deps.mediaRoots.listRoots()).map((root) => [root.id, root]));
    const libraries = new Map(repositories.mediaLibraries.list().map((library) => [library.id, library.name]));
    return {
      items: repositories.pending.list().map((item) => {
        const root = roots.get(item.rootId);
        return this.toDto(item, root ? resolveRootRelativePath(root, item.relativePath) : item.relativePath, libraries);
      }),
    };
  }

  async detail(id: string): Promise<PendingDetailResponse> {
    const repositories = await this.deps.repositories();
    const item = repositories.pending.get(id);
    const root = await this.deps.mediaRoots.get(item.rootId);
    const libraries = new Map(repositories.mediaLibraries.list().map((library) => [library.id, library.name]));
    return {
      item: this.toDto(item, resolveRootRelativePath(root, item.relativePath), libraries),
      siteResults: item.number
        ? repositories.siteResults
            .list(item.number)
            .map(({ data: _data, number: _number, updatedAt, ...result }) =>
              pendingSiteResultSchema.parse({ ...result, updatedAt: updatedAt.toISOString() }),
            )
        : [],
    };
  }

  /** Scrapes the file again; the entry stays until that outcome replaces or clears it. */
  async retry(input: PendingRetryInput): Promise<PendingRetryResponse> {
    const repositories = await this.deps.repositories();
    const item = repositories.pending.get(input.id);
    if (item.kind === "uncensored") throw new Error("This movie is published; confirm its type instead");
    const libraryId = input.libraryId ?? item.libraryId;
    if (!libraryId) throw new Error("Choose a library to scrape this file into");
    const candidate = input.candidate === undefined ? undefined : this.candidates(item)[input.candidate];
    if (input.candidate !== undefined && !candidate) throw new Error("The chosen work is not in this entry");
    const manualUrl = candidate?.detailUrl ?? input.manualUrl;
    if (input.rule) await this.saveRule(input.rule, input.number);
    const { taskId } = await this.deps.startScrape({
      executionMode: "single",
      libraryId,
      refs: [{ rootId: item.rootId, relativePath: item.relativePath }],
      ...(manualUrl ? { manualUrl } : {}),
      ...(input.number ? { number: input.number } : {}),
    });
    return { taskId };
  }

  async confirmUncensored(input: PendingConfirmUncensoredInput): Promise<void> {
    const repositories = await this.deps.repositories();
    const item = repositories.pending.get(input.id);
    if (item.kind !== "uncensored" || !item.movieId) throw new Error("This entry has no uncensored type to confirm");
    const configuration = await this.deps.getConfiguration();
    if (!configuration.download.generateNfo)
      throw new Error("NFO generation is disabled; cannot confirm uncensored type");
    const entry = await repositories.library.getEntryById(item.movieId);
    const library = item.libraryId ? toMediaLibrary(repositories.mediaLibraries.get(item.libraryId)) : undefined;
    // A library that placed the files reorganizes them under the new name; others only rewrite the NFO in place.
    const reorganize = library && ["move", "hardlink", "copy"].includes(library.placement);
    const roots = await this.deps.mediaRoots.listRoots();
    const root = roots.find((candidate) => candidate.id === entry.files[0]?.rootId);
    if (!root) throw new Error("Movie is missing valid media files");
    await this.deps.mediaRoots.assertRootIntegrity(
      new Set([...entry.files.map((file) => file.rootId), ...entry.assets.flatMap((asset) => asset.rootId ?? [])]),
    );
    const result = await this.deps.maintenanceRuntime.applyLibraryEntry({
      root,
      presetId: reorganize ? "local_organize" : "remerge",
      target:
        reorganize && item.libraryId ? toPublicationTarget(repositories.mediaLibraries.get(item.libraryId)) : undefined,
      entry,
      localState: { uncensoredChoice: input.choice },
      publication: {
        roots,
        identity: {
          movieId: entry.id,
          assets: entry.assets.flatMap((asset) =>
            asset.rootId && asset.relativePath
              ? [
                  {
                    rootId: asset.rootId,
                    relativePath: asset.relativePath,
                    fileId: asset.fileId,
                    kind: asset.kind,
                    published: asset.published,
                  },
                ]
              : [],
          ),
        },
        commit: (movie) => {
          const rows = committedMovieRows(movie);
          repositories.library.writeEntry(rows.movie, rows.files);
          repositories.pending.delete([item.id]);
        },
      },
    });
    if (result.status === "failed") throw new Error(result.error);
    this.deps.onChanged?.();
  }

  async ignore(id: string): Promise<void> {
    (await this.deps.repositories()).pending.delete([id]);
    this.deps.onChanged?.();
  }

  private async saveRule(rule: NonNullable<PendingRetryInput["rule"]>, number: string | undefined): Promise<void> {
    const configuration = await this.deps.getConfiguration();
    if (rule.kind === "ignoreToken") {
      const tokens = configuration.scrape.filenameIgnoreTokens;
      if (!tokens.includes(rule.token))
        await this.deps.updateConfiguration({ scrape: { filenameIgnoreTokens: [...tokens, rule.token] } });
      return;
    }
    if (!number) throw new Error("A number mapping needs the corrected number");
    await this.deps.updateConfiguration({
      scrape: { numberMappings: { ...configuration.scrape.numberMappings, [rule.match]: number } },
    });
  }

  private candidates(item: PendingItemRecord): AmbiguousCandidate[] {
    return item.candidatesJson ? candidatesSchema.parse(JSON.parse(item.candidatesJson)) : [];
  }

  private toDto(item: PendingItemRecord, absolutePath: string, libraries: ReadonlyMap<string, string>): PendingItemDto {
    return {
      id: item.id,
      kind: item.kind,
      ref: { rootId: item.rootId, relativePath: item.relativePath },
      path: absolutePath,
      fileName: path.basename(item.relativePath),
      libraryId: item.libraryId,
      libraryName: item.libraryId ? (libraries.get(item.libraryId) ?? null) : null,
      movieId: item.movieId,
      number: item.number,
      detail: item.detail,
      candidates: this.candidates(item),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }
}

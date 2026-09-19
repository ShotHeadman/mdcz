import { stat } from "node:fs/promises";
import { dirname, isAbsolute, relative } from "node:path";
import { type MediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import type { LibraryFileInput, LibraryMovieInput } from "@mdcz/persistence";
import type { Configuration } from "@mdcz/shared/config";
import type { LocalScanEntry, UncensoredChoice, UncensoredConfirmResultItem } from "@mdcz/shared/types";
import { registeredMediaLocations } from "../library/registeredMedia";
import { MaintenanceRuntime } from "../maintenance/MaintenanceRuntime";
import type { DurablePublicationContext, PublicationOutputPort } from "../publication/types";
import { FileOrganizer } from "./FileOrganizer";
import { NfoGenerator } from "./nfo";
import { parseFileInfo } from "./utils/number";

export interface RuntimeUncensoredConfirmFailure {
  fileId: string;
  videoPath: string;
  message: string;
}

export interface RuntimeUncensoredConfirmResult {
  updatedCount: number;
  items: UncensoredConfirmResultItem[];
  failures: RuntimeUncensoredConfirmFailure[];
}

export interface ConfirmUncensoredFileRecord {
  id: string;
  rootId: string;
  rootRelativePath: string;
  partNumber?: number | null;
  partSuffix?: string | null;
  resolution?: string | null;
}

export interface ConfirmUncensoredItemOutcome {
  id: string;
  itemId: string;
  outcome: string;
  outputRootId: string | null;
  outputRelativePath: string | null;
}

export interface ConfirmUncensoredResolvedEntry {
  id: string;
  title?: string | null;
  number?: string | null;
  mediaIdentity?: string | null;
  crawlerDataJson?: string | null;
  assets?: Array<{
    fileId: string | null;
    kind: string;
    rootId?: string | null;
    relativePath?: string | null;
    published?: boolean;
  }>;
}

export interface ConfirmUncensoredResolvedFile {
  file: ConfirmUncensoredFileRecord;
  choice: UncensoredChoice;
  outcome: { id: string };
  entry: ConfirmUncensoredResolvedEntry;
}

export async function confirmUncensoredRunItems<TManifest extends { items: readonly { id: string }[] }>(input: {
  manifest: TManifest;
  items: readonly { itemId: string; choice: UncensoredChoice }[];
  configuration: Configuration;
  roots: readonly MediaRoot[];
  repositories: DurablePublicationContext & {
    library: PublicationOutputPort & {
      resolveUncensoredFiles(
        selections: readonly { outcomeId: string; choice: UncensoredChoice }[],
      ): Promise<ConfirmUncensoredResolvedFile[]>;
      getEntryById(id: string): Promise<ConfirmUncensoredResolvedEntry>;
    };
    scrapeRuns: {
      summary(manifest: TManifest): unknown;
      itemResults(manifest: TManifest): ConfirmUncensoredItemOutcome[];
      reviseSuccess(
        revisions: Array<{
          itemId?: string;
          outcomeId?: string;
          libraryEntry: LibraryFileInput;
          uncensoredAmbiguous?: boolean;
        }>,
        movie: LibraryMovieInput,
      ): void;
    };
  };
  dependencies?: {
    fileOrganizer?: Pick<FileOrganizer, "plan" | "resolveOutputPlan">;
    localScanService?: unknown;
    logger?: { info(message: string): void; warn(message: string, error?: unknown): void };
    nfoGenerator?: Pick<NfoGenerator, "writeNfo">;
    pathExists?: (filePath: string) => Promise<boolean>;
  };
}): Promise<RuntimeUncensoredConfirmResult> {
  const { manifest, repositories, roots } = input;
  if (!repositories.scrapeRuns.summary(manifest)) throw new Error("仅支持对已完成且刮削成功的项目进行无码确认");
  const outcomes = new Map(repositories.scrapeRuns.itemResults(manifest).map((outcome) => [outcome.itemId, outcome]));
  const selections = input.items.map(({ itemId, choice }) => {
    if (!manifest.items.some((item) => item.id === itemId))
      throw new Error(`Item does not belong to scrape task: ${itemId}`);
    const outcome = outcomes.get(itemId);
    if (!outcome || outcome.outcome !== "success" || !outcome.outputRootId || !outcome.outputRelativePath)
      throw new Error(`Item does not belong to successful scrape output: ${itemId}`);
    return { outcomeId: outcome.id, choice };
  });

  const files = await repositories.library.resolveUncensoredFiles(selections);
  const choices = new Map<string, UncensoredChoice>();
  for (const { choice, entry } of files) {
    if (choices.has(entry.id) && choices.get(entry.id) !== choice) throw new Error("同一影片不能选择不同的无码类型");
    choices.set(entry.id, choice);
  }

  const resolveRoot = async (id: string) => {
    const root = roots.find((r) => r.id === id);
    if (!root) throw new Error(`Publication root not found: ${id}`);
    return root;
  };

  const resolved = await Promise.all(
    files.map(async (selected) => {
      const { rootId, rootRelativePath } = selected.file;
      if (!rootId || !rootRelativePath)
        throw new Error(`Successful scrape outcome is missing output facts: ${selected.outcome.id}`);
      return {
        ...selected,
        rootId,
        rootRelativePath,
        videoPath: resolveRootRelativePath(await resolveRoot(rootId), rootRelativePath),
      };
    }),
  );

  const locations = await registeredMediaLocations(
    repositories.library,
    resolveRoot,
    resolved.map((file) => file.videoPath),
  );

  const failures: RuntimeUncensoredConfirmFailure[] = [];
  const updatedItems: UncensoredConfirmResultItem[] = [];

  const baseConfig: Configuration = {
    ...input.configuration,
    download: { ...input.configuration.download, generateNfo: true },
  };

  const runtime = new MaintenanceRuntime({
    actorImageService: { prepareActorProfilesForMovie: async () => undefined },
    config: { get: async () => baseConfig },
    fileOrganizer: input.dependencies?.fileOrganizer ?? new FileOrganizer(),
    nfoGenerator: input.dependencies?.nfoGenerator ?? new NfoGenerator(),
    signalService: { setProgress: () => undefined, showLogText: () => undefined },
  });

  const movieGroups = new Map<string, typeof resolved>();
  for (const item of resolved) {
    const group = movieGroups.get(item.entry.id) ?? [];
    group.push(item);
    movieGroups.set(item.entry.id, group);
  }

  for (const [movieId, group] of movieGroups) {
    const choice = choices.get(movieId);
    if (!choice) continue;
    let metadataPath = baseConfig.paths.metadataPath;
    const existingNfo = group.map((item) => locations.get(item.videoPath)?.nfoPath).find(Boolean);
    if (existingNfo) {
      const existingRoot = roots.find((r) => {
        const rel = relative(r.hostPath, existingNfo);
        return rel && !rel.startsWith("..") && !isAbsolute(rel);
      });
      if (existingRoot) metadataPath = existingRoot.hostPath;
    }
    const config: Configuration = {
      ...baseConfig,
      paths: { ...baseConfig.paths, metadataPath },
    };

    let missingFile = false;
    for (const item of group) {
      const nfoPath = locations.get(item.videoPath)?.nfoPath?.trim();
      const videoPath = item.videoPath.trim();
      const checkExists =
        input.dependencies?.pathExists ??
        (async (p: string) => {
          try {
            await stat(p);
            return true;
          } catch {
            return false;
          }
        });
      if (!videoPath || (nfoPath && !(await checkExists(nfoPath))) || !(await checkExists(videoPath))) {
        missingFile = true;
        input.dependencies?.logger?.warn(
          `Skipping uncensored confirm: output files not found for ${videoPath || nfoPath}`,
        );
        failures.push({
          fileId: item.file.id,
          videoPath,
          message: `Skipping uncensored confirm: output files not found for ${videoPath || nfoPath}`,
        });
      }
    }
    if (missingFile) {
      for (const item of group) {
        if (!failures.some((f) => f.fileId === item.file.id)) {
          failures.push({
            fileId: item.file.id,
            videoPath: item.videoPath,
            message: "影片中存在缺失或无法访问的文件，操作已取消（未修改任何文件）",
          });
        }
      }
      continue;
    }

    const localEntries: LocalScanEntry[] = group.map((item) => {
      const loc = locations.get(item.videoPath);
      return {
        fileId: item.file.id,
        ref: { rootId: item.rootId, relativePath: item.rootRelativePath },
        fileInfo: parseFileInfo(item.videoPath, input.configuration.scrape.filenameIgnoreTokens),
        currentDir: dirname(item.videoPath),
        nfoPath: loc?.nfoPath,
        strmPath: loc?.strmPath,
        assets: loc?.assets ?? { sceneImages: [], actorPhotos: [] },
        crawlerData: item.entry.crawlerDataJson ? JSON.parse(item.entry.crawlerDataJson) : undefined,
        nfoLocalState: { uncensoredChoice: choice },
      };
    });

    const firstEntry = localEntries[0];
    const firstSelected = group[0];
    const root = await resolveRoot(firstSelected.rootId);
    const operationId = `uncensored-confirm:${movieId}`;

    try {
      const movieRuntime = await runtime.createSession({
        root,
        outputRoot: root,
        outputRelativeDirectory: "",
        configuration: config,
        inventory: runtime.inventory,
      });
      const result = await movieRuntime.applyEntry({
        root,
        presetId: "local_organize",
        entry: firstEntry,
        files: localEntries,
        publication: {
          journal: repositories.journal,
          operationId,
          roots,
          identity: {
            movieId,
            assets: (firstSelected.entry.assets ?? [])
              .filter((a): a is typeof a & { rootId: string; relativePath: string } =>
                Boolean(a.rootId && a.relativePath),
              )
              .map((a) => ({
                rootId: a.rootId,
                relativePath: a.relativePath,
                fileId: a.fileId,
                kind: a.kind,
                published: a.published ?? true,
              })),
          },
          commit: (movie) => {
            repositories.scrapeRuns.reviseSuccess(
              group.map((selected) => {
                const pubFile = movie.files.find((f) => f.fileId === selected.file.id);
                return {
                  itemId: selected.outcome.id,
                  outcomeId: selected.outcome.id,
                  uncensoredAmbiguous: false,
                  libraryEntry: {
                    fileId: selected.file.id,
                    partNumber: selected.file.partNumber,
                    partSuffix: selected.file.partSuffix,
                    resolution: selected.file.resolution,
                    rootId: pubFile?.rootId ?? selected.rootId,
                    rootRelativePath: pubFile?.rootRelativePath ?? selected.rootRelativePath,
                    size: pubFile?.size ?? 0,
                    modifiedAt: pubFile?.modifiedAtMs ? new Date(pubFile.modifiedAtMs) : null,
                    assets: movie.assets.filter((a) => a.fileId === selected.file.id),
                    lastKnownPath: pubFile?.rootRelativePath ?? selected.rootRelativePath,
                  },
                };
              }),
              {
                id: movie.id,
                mediaIdentity: movie.mediaIdentity,
                title: movie.title,
                number: movie.number,
                actors: [...movie.actors],
                crawlerDataJson: movie.crawlerDataJson,
                lastRefreshedAt: new Date(),
                assets: movie.assets.filter((a) => a.fileId === null),
              },
            );
          },
        },
      });

      if (result.status === "success") {
        for (const item of group) {
          const pubFile = result.output?.files?.find((f) => f.fileId === item.file.id);
          const targetRoot = roots.find((r) => r.id === pubFile?.target.rootId);
          const targetVideoPath =
            targetRoot && pubFile
              ? resolveRootRelativePath(targetRoot, pubFile.target.relativePath)
              : result.entry.fileId === item.file.id
                ? result.entry.fileInfo.filePath
                : item.videoPath;
          updatedItems.push({
            fileId: item.file.id,
            sourceVideoPath: item.videoPath,
            sourceNfoPath: locations.get(item.videoPath)?.nfoPath,
            targetVideoPath,
            targetNfoPath: result.output?.nfoPath ?? result.entry.nfoPath,
            choice,
          });
          input.dependencies?.logger?.info(`Updated uncensored choice to "${choice}" for ${item.videoPath}`);
        }
      } else {
        const errorMsg = result.error ?? "Failed to finalize uncensored confirm";
        for (const item of group) {
          failures.push({
            fileId: item.file.id,
            videoPath: item.videoPath,
            message: `Failed to finalize ${item.videoPath}: ${errorMsg}`,
          });
        }
      }
    } catch (error) {
      const errorMsg = (error as Error).message ?? String(error);
      for (const item of group) {
        failures.push({
          fileId: item.file.id,
          videoPath: item.videoPath,
          message: `Failed to finalize ${item.videoPath}: ${errorMsg}`,
        });
      }
    }
  }

  return { updatedCount: updatedItems.length, items: updatedItems, failures };
}

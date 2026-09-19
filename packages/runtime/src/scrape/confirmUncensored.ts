import { dirname } from "node:path";
import { type MediaRoot, resolveRootFile, resolveRootRelativePath } from "@mdcz/media-store";
import type { Configuration } from "@mdcz/shared/config";
import { toErrorMessage } from "@mdcz/shared/error";
import type { AssetRef, RootFileRef } from "@mdcz/shared/mediaRef";
import { crawlerDataSchema } from "@mdcz/shared/serverDtos";
import type {
  CrawlerData,
  DiscoveredAssets,
  FileId,
  FileInfo,
  LocalScanEntry,
  NfoLocalState,
  UncensoredChoice,
  UncensoredConfirmResultItem,
} from "@mdcz/shared/types";
import { registeredMediaLocations } from "../library/registeredMedia";
import type { LocalScanService } from "../maintenance/LocalScanService";
import { buildMovieTags } from "../maintenance/movieTags";
import { resolvePublicationAssetLayout } from "../publication/assetLayout";
import { MoveOutput } from "../publication/MoveOutput";
import { libraryAssetsFromMovieOutput } from "../publication/outputLibrary";
import { toRootFileRef } from "../publication/outputRefs";
import {
  type PreparedMovieFile,
  type PreparedMovieOutput,
  prepareMovieOutput,
} from "../publication/prepareMovieOutput";
import type { DurablePublicationContext, PublicationOutputPort } from "../publication/types";
import { WriteOutput } from "../publication/WriteOutput";
import type { RuntimeLogger } from "../shared";
import type { FileOrganizer, ResolvedPublicationLayout } from "./FileOrganizer";
import { getNfoWritePaths, type NfoGenerator, nfoIgnoreFieldsToEnabledFields } from "./nfo";
import { parseFileInfo } from "./utils/number";

export interface RuntimeUncensoredConfirmItem<TContext = undefined> {
  context?: TContext;
  groupId: string;
  fileId: FileId;
  videoPath: string;
  metadataVideoPath?: string;
  nfoPath?: string;
  crawlerData?: CrawlerData;
  registeredAssets?: DiscoveredAssets;
  choice: UncensoredChoice;
}

export interface RuntimeUncensoredConfirmFailure {
  fileId: FileId;
  videoPath: string;
  message: string;
}

export interface RuntimeUncensoredConfirmResult {
  updatedCount: number;
  items: UncensoredConfirmResultItem[];
  failures: RuntimeUncensoredConfirmFailure[];
}

interface PreparedUncensoredConfirmItem<TContext> {
  item: RuntimeUncensoredConfirmItem<TContext>;
  entry: LocalScanEntry;
  effectiveNfoPath?: string;
  nextLocalState: NfoLocalState;
}

export interface UncensoredPlanningMember<TContext = undefined> {
  item: RuntimeUncensoredConfirmItem<TContext>;
  entry: LocalScanEntry;
  layout: ResolvedPublicationLayout;
  existingNfoPath?: string;
}

export interface UncensoredConfirmedMember<TContext> {
  item: RuntimeUncensoredConfirmItem<TContext>;
  publicationFile: PreparedMovieFile;
  sourceNfoPath?: string;
  nfoPath?: string;
}

export interface UncensoredConfirmDependencies<TContext = undefined> {
  fileOrganizer: Pick<FileOrganizer, "plan" | "resolveOutputPlan">;
  localScanService: Pick<LocalScanService, "scanVideo">;
  logger: Pick<RuntimeLogger, "info" | "warn">;
  nfoGenerator: Pick<NfoGenerator, "writeNfo">;
  pathExists: (filePath: string) => Promise<boolean>;
  preparePublication(input: {
    operationId: string;
    members: readonly UncensoredPlanningMember<TContext>[];
    nfoNaming: "both" | "movie" | "filename";
    writeNfo: Parameters<typeof prepareMovieOutput>[0]["writeNfo"];
  }): Promise<{
    output: PreparedMovieOutput;
    assets: DiscoveredAssets;
    nfoPath?: string;
    resolve(ref: RootFileRef): string;
  }>;
  publish(input: {
    operationId: string;
    output: PreparedMovieOutput;
    members: readonly UncensoredConfirmedMember<TContext>[];
  }): Promise<void>;
}

export interface UncensoredRevisionSources {
  output: PreparedMovieOutput;
  publicationFile: PreparedMovieFile;
  nfoPath?: string;
  file: {
    id: string;
    itemId?: string;
    partNumber: number | null;
    partSuffix: string | null;
    resolution: string | null;
  };
  outcome: { id: string };
  roots: readonly Pick<MediaRoot, "id" | "hostPath">[];
  entry: {
    crawlerDataJson: string | null;
    files: Array<{
      id: string;
      partNumber: number | null;
      partSuffix: string | null;
      resolution: string | null;
    }>;
    id: string;
    mediaIdentity: string | null;
    title: string | null;
    number: string | null;
    actors: string[];
    createdAt: Date;
    assets: Array<{
      kind: string;
      uri: string;
      rootId: string | null;
      relativePath: string | null;
      fileId: string | null;
      published: boolean;
    }>;
  };
}

export async function confirmUncensoredRunItems<TManifest extends { items: readonly { id: string }[] }>(input: {
  manifest: TManifest;
  items: readonly { itemId: string; choice: UncensoredChoice }[];
  configuration: Configuration;
  roots: readonly MediaRoot[];
  repositories: DurablePublicationContext & {
    library: PublicationOutputPort & {
      resolveUncensoredFiles(selections: { outcomeId: string; choice: UncensoredChoice }[]): Promise<
        Array<{
          choice: UncensoredChoice;
          file: {
            id: string;
            rootId: string | null;
            rootRelativePath: string | null;
            partNumber: number | null;
            partSuffix: string | null;
            resolution: string | null;
          };
          outcome: { id: string };
          entry: UncensoredRevisionSources["entry"];
        }>
      >;
      getEntryById(id: string): Promise<UncensoredRevisionSources["entry"]>;
    };
    scrapeRuns: {
      summary(manifest: TManifest): unknown;
      itemResults(manifest: TManifest): Array<{
        id: string;
        itemId: string;
        outcome: string;
        outputRootId: string | null;
        outputRelativePath: string | null;
      }>;
      reviseSuccess(
        revisions: ReturnType<typeof buildUncensoredRevision>[],
        movie: ReturnType<typeof buildUncensoredRevision>["movie"],
      ): unknown;
    };
  };
  dependencies: Omit<UncensoredConfirmDependencies, "publish" | "preparePublication">;
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
  const snapshots = new Map(files.map(({ entry }) => [entry.id, JSON.stringify(entry.files)]));
  const resolveRoot = async (id: string) => {
    const root = roots.find((root) => root.id === id);
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
  return confirmUncensoredOutputs(
    resolved.map((selected) => {
      const { choice, file, entry, videoPath } = selected;
      return {
        context: selected,
        fileId: file.id,
        groupId: entry.id,
        videoPath,
        choice,
        crawlerData: entry.crawlerDataJson ? crawlerDataSchema.parse(JSON.parse(entry.crawlerDataJson)) : undefined,
        nfoPath: locations.get(videoPath)?.nfoPath,
        metadataVideoPath: locations.get(videoPath)?.strmPath,
        registeredAssets: locations.get(videoPath)?.assets,
      };
    }),
    input.configuration,
    {
      ...input.dependencies,
      preparePublication: async ({ operationId, members, nfoNaming, writeNfo }) => {
        const selected = members[0]?.item.context;
        if (!selected) throw new Error("Uncensored publication has no selected movie");
        return await prepareUncensoredPublication({
          config: input.configuration,
          operationId,
          members,
          nfoNaming,
          writeNfo,
          roots,
          entry: selected.entry,
          snapshot: repositories.library.publicationSnapshot({
            paths: members.flatMap(({ layout }) => [
              layout.sourceVideoPath,
              layout.targetVideoPath,
              layout.nfoPath,
              ...(layout.mirror ? [layout.mirror.targetPath] : []),
              ...layout.sidecars.flatMap((sidecar) => [
                sidecar.targetPath,
                ...(sidecar.mirrorPath ? [sidecar.mirrorPath] : []),
              ]),
            ]),
            includeOwners: true,
          }),
        });
      },
      publish: async ({ output, members }) => {
        const revisions = members.map(({ item, publicationFile, nfoPath }) => {
          const target = item.context;
          if (!target) throw new Error(`Uncensored confirmation item disappeared: ${item.fileId}`);
          return buildUncensoredRevision({
            output,
            publicationFile,
            nfoPath,
            roots,
            file: target.file,
            outcome: target.outcome,
            entry: target.entry,
          });
        });
        const movie = revisions[0]?.movie;
        if (!movie) throw new Error("Uncensored publication has no movie write");
        const validate = async () => {
          if (JSON.stringify((await repositories.library.getEntryById(movie.id)).files) !== snapshots.get(movie.id))
            throw new Error("影片关联的视频文件发生变动，请重新确认");
        };
        const commit = () => repositories.scrapeRuns.reviseSuccess(revisions, movie);
        const published = output.moves.length
          ? await new MoveOutput().install({
              operationId: output.operationId,
              operationType: "maintenance",
              moves: output.moves,
              artifacts: output.artifacts,
              journal: repositories.journal,
              validate,
              protectedSourceRoots: output.protectedSourceRoots,
              commit,
            })
          : await new WriteOutput().install(output.artifacts, {
              validate,
              protectedSourceRoots: output.protectedSourceRoots,
              commit,
            });
        for (const issue of published.cleanupIssues)
          input.dependencies.logger.warn(`Uncensored publication cleanup failed: ${toErrorMessage(issue)}`);
      },
    },
  );
}

/**
 * Both hosts persist the same facts after a confirmation, so the mapping from
 * published paths to outcome and library revisions lives here rather than being
 * mirrored in the desktop and server services.
 */
export const prepareUncensoredPublication = async <TContext = undefined>(input: {
  config: Configuration;
  operationId: string;
  members: readonly UncensoredPlanningMember<TContext>[];
  nfoNaming: "both" | "movie" | "filename";
  writeNfo: Parameters<typeof prepareMovieOutput>[0]["writeNfo"];
  roots: readonly Pick<MediaRoot, "id" | "hostPath">[];
  entry: UncensoredRevisionSources["entry"];
  snapshot: ReturnType<PublicationOutputPort["publicationSnapshot"]>;
}): Promise<{
  output: PreparedMovieOutput;
  assets: DiscoveredAssets;
  nfoPath?: string;
  resolve(ref: RootFileRef): string;
}> => {
  const participants = {
    movieId: input.entry.id,
    members: await Promise.all(
      input.members.map(async (member) => ({
        fileId: member.item.fileId,
        layout: member.layout,
        existingAssets: member.entry.assets,
        existingNfoPath: member.existingNfoPath,
        assetLayout: await resolvePublicationAssetLayout({
          layout: member.layout,
          config: input.config,
          existingAssets: member.entry.assets,
        }),
        source: toRootFileRef(member.layout.sourceVideoPath, input.roots),
      })),
    ),
    expected: {
      files: input.snapshot.files.filter((file) => file.itemId === input.entry.id),
      assets: input.snapshot.assets.filter((asset) => asset.itemId === input.entry.id),
    },
  };
  const producedKinds = new Set(["thumb", "poster", "fanart", "trailer", "scene", "actor"]);
  const retainedMovieAssets: AssetRef[] = input.entry.assets.flatMap((asset): AssetRef[] => {
    if (asset.fileId !== null || producedKinds.has(asset.kind)) return [];
    return asset.rootId && asset.relativePath
      ? [{ type: "local", kind: asset.kind, file: { rootId: asset.rootId, relativePath: asset.relativePath } }]
      : [{ type: "remote", kind: asset.kind, url: asset.uri }];
  });
  const prepared = await prepareMovieOutput({
    operationId: input.operationId,
    operationType: "maintenance",
    roots: input.roots,
    identity: participants,
    downloadedAssets: { downloaded: [], sceneImages: [] },
    actorPhotoPaths: [],
    retainedMovieAssets,
    nfoNaming: input.nfoNaming,
    writeNfo: input.writeNfo,
  });
  return {
    ...prepared,
    output: prepared.output,
    resolve: (ref) => {
      const root = input.roots.find((root) => root.id === ref.rootId);
      if (!root) throw new Error(`Publication root not found: ${ref.rootId}`);
      return resolveRootRelativePath(root, ref.relativePath);
    },
  };
};

export const buildUncensoredRevision = (sources: UncensoredRevisionSources) => {
  const { outcome, entry, file, publicationFile, output } = sources;
  const nfo = sources.nfoPath ? resolveRootFile(sources.roots, sources.nfoPath) : undefined;
  const crawlerDataJson = entry.crawlerDataJson;
  if (!crawlerDataJson) throw new Error("影片缺少抓取到的元数据，无法确认无码类型");
  const crawlerData = crawlerDataSchema.parse(JSON.parse(crawlerDataJson));
  if (publicationFile.fileId !== file.id) throw new Error("待发布文件与当前选中的影片记录不匹配");
  return {
    outcomeId: outcome.id,
    crawlerDataJson,
    nfoRootId: nfo && nfo.root.id !== publicationFile.target.rootId ? nfo.root.id : null,
    nfoRelativePath: nfo?.relativePath ?? null,
    outputRootId: publicationFile.target.rootId,
    outputRelativePath: publicationFile.target.relativePath,
    uncensoredAmbiguous: false,
    size: publicationFile.size,
    modifiedAt: publicationFile.modifiedAt,
    movie: {
      id: output.movieId,
      assets: libraryAssetsFromMovieOutput(output, output.movieAssets),
      mediaIdentity: entry.mediaIdentity,
      title: entry.title ?? crawlerData.title,
      number: entry.number ?? crawlerData.number,
      actors: entry.actors,
      crawlerDataJson,
      createdAt: entry.createdAt,
      lastRefreshedAt: new Date(),
    },
    libraryEntry: {
      fileId: file.id,
      partNumber: file.partNumber,
      partSuffix: file.partSuffix,
      resolution: file.resolution,
      rootId: publicationFile.target.rootId,
      rootRelativePath: publicationFile.target.relativePath,
      size: publicationFile.size,
      modifiedAt: publicationFile.modifiedAt,
      assets: libraryAssetsFromMovieOutput(output, publicationFile.assets),
      lastKnownPath: publicationFile.target.relativePath,
    },
  };
};

const buildSharedFileInfo = (entries: LocalScanEntry[], outputVideoPath: string): FileInfo | undefined => {
  const firstEntry = entries[0];
  if (!firstEntry) return undefined;
  const subtitleSource = entries.find((entry) => entry.fileInfo.isSubtitled || Boolean(entry.fileInfo.subtitleTag));
  return {
    ...firstEntry.fileInfo,
    filePath: outputVideoPath,
    isSubtitled: entries.some((entry) => entry.fileInfo.isSubtitled),
    subtitleTag: subtitleSource?.fileInfo.subtitleTag,
    part: undefined,
  };
};

export const confirmUncensoredOutputs = async <TContext = undefined>(
  items: RuntimeUncensoredConfirmItem<TContext>[],
  config: Configuration,
  dependencies: UncensoredConfirmDependencies<TContext>,
): Promise<RuntimeUncensoredConfirmResult> => {
  const updatedItems: UncensoredConfirmResultItem[] = [];
  const failures: RuntimeUncensoredConfirmFailure[] = [];
  const preparedItems: PreparedUncensoredConfirmItem<TContext>[] = [];
  const choices = new Map<string, UncensoredChoice>();
  for (const item of items) {
    const key = item.groupId;
    if (choices.has(key) && choices.get(key) !== item.choice) throw new Error("同一影片不能选择不同的无码类型");
    choices.set(key, item.choice);
  }
  const fail = (item: RuntimeUncensoredConfirmItem<TContext>, message: string): void => {
    dependencies.logger.warn(message);
    failures.push({ fileId: item.fileId, videoPath: item.videoPath, message });
  };

  for (const item of items) {
    try {
      const nfoPath = item.nfoPath?.trim();
      const videoPath = item.videoPath.trim();
      if (
        !videoPath ||
        (nfoPath && !(await dependencies.pathExists(nfoPath))) ||
        !(await dependencies.pathExists(videoPath))
      ) {
        fail(item, `Skipping uncensored confirm: output files not found for ${videoPath || nfoPath}`);
        continue;
      }

      const root: MediaRoot = {
        id: item.fileId,
        displayName: dirname(videoPath),
        hostPath: dirname(videoPath),
        realPath: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const scannedEntry = await dependencies.localScanService.scanVideo(
        root,
        videoPath,
        config.paths.sceneImagesFolder,
        undefined,
        {
          mediaPath: "",
          metadataPath: "",
          registeredOutputs: new Map([[videoPath, { nfoPath, strmPath: item.metadataVideoPath }]]),
        },
      );
      const effectiveNfoPath = scannedEntry.nfoPath ?? nfoPath;
      const crawlerData = item.crawlerData ?? scannedEntry.crawlerData;
      if (!crawlerData || (effectiveNfoPath && !(await dependencies.pathExists(effectiveNfoPath)))) {
        fail(item, `Skipping uncensored confirm: incomplete local output for ${videoPath}`);
        continue;
      }

      const entry = {
        ...scannedEntry,
        assets: item.registeredAssets ?? scannedEntry.assets,
        fileInfo: {
          ...parseFileInfo(videoPath, config.scrape.filenameIgnoreTokens),
          isSubtitled: scannedEntry.fileInfo.isSubtitled,
          subtitleTag: scannedEntry.fileInfo.subtitleTag,
        },
        crawlerData,
        currentDir: dirname(videoPath),
      };
      preparedItems.push({
        item,
        entry,
        effectiveNfoPath,
        nextLocalState: { ...entry.nfoLocalState, uncensoredChoice: item.choice },
      });
    } catch (error) {
      fail(item, `Failed to prepare uncensored confirmation for ${item.videoPath}: ${toErrorMessage(error)}`);
    }
  }

  const batches = new Map<string, PreparedUncensoredConfirmItem<TContext>[]>();
  for (const prepared of preparedItems) {
    const key = prepared.item.groupId;
    batches.set(key, [...(batches.get(key) ?? []), prepared]);
  }

  for (const batchItems of batches.values()) {
    if (
      items.some(
        (item) =>
          item.groupId === batchItems[0].item.groupId && failures.some((failure) => failure.fileId === item.fileId),
      )
    ) {
      for (const prepared of batchItems)
        fail(prepared.item, "影片中存在缺失或无法访问的文件，操作已取消（未修改任何文件）");
      continue;
    }
    const processedItems: Array<
      PreparedUncensoredConfirmItem<TContext> & { outputVideoPath: string; plan: ResolvedPublicationLayout }
    > = [];
    for (const prepared of batchItems) {
      try {
        const rawPlan = dependencies.fileOrganizer.plan(
          prepared.entry.fileInfo,
          prepared.entry.crawlerData as CrawlerData,
          config,
          prepared.nextLocalState,
        );
        const plan = await dependencies.fileOrganizer.resolveOutputPlan(rawPlan, prepared.entry.fileInfo.filePath, {
          existingMetadataDir: dirname(
            prepared.effectiveNfoPath ?? prepared.item.metadataVideoPath ?? prepared.item.videoPath,
          ),
          strmPathMappings: config.paths.strmPathMappings,
        });
        const outputVideoPath = plan.targetVideoPath;
        processedItems.push({ ...prepared, outputVideoPath, plan });
      } catch (error) {
        fail(prepared.item, `Failed to reorganize ${prepared.item.videoPath}: ${toErrorMessage(error)}`);
      }
    }
    if (processedItems.length === 0) continue;
    if (processedItems.length !== batchItems.length) {
      for (const processed of processedItems) fail(processed.item, "Cannot partially reorganize videos sharing an NFO");
      continue;
    }

    let savedNfoPath: string | undefined;
    const nfoArtifacts = new Map<string, string>();
    try {
      const seed = processedItems[0];
      savedNfoPath =
        config.download.generateNfo || seed.effectiveNfoPath
          ? await dependencies.nfoGenerator.writeNfo(seed.plan.nfoPath, seed.entry.crawlerData as CrawlerData, {
              fileInfo: buildSharedFileInfo(
                processedItems.map((item) => item.entry),
                seed.outputVideoPath,
              ),
              localState: seed.nextLocalState,
              nfoNaming: config.download.nfoNaming,
              enabledFields: nfoIgnoreFieldsToEnabledFields(config.download.nfoIgnoreFields),
              nfoTitleTemplate: config.naming.nfoTitleTemplate,
              buildTags: buildMovieTags,
              writeFile: async (targetPath, content) => {
                nfoArtifacts.set(targetPath, content);
              },
            })
          : undefined;
    } catch (error) {
      const message = `Failed to write uncensored confirmation NFO: ${toErrorMessage(error)}`;
      for (const processed of processedItems) fail(processed.item, message);
      continue;
    }

    try {
      const operationId = `uncensored-confirm:${processedItems.map(({ item }) => item.fileId).join(":")}`;
      const planningMembers: UncensoredPlanningMember<TContext>[] = processedItems.map((processed) => ({
        item: processed.item,
        entry: processed.entry,
        layout: processed.plan,
        existingNfoPath: processed.effectiveNfoPath,
      }));
      const publication = await dependencies.preparePublication({
        operationId,
        members: planningMembers,
        nfoNaming: config.download.nfoNaming,
        writeNfo: async (_assets, writeFile) => {
          const content = nfoArtifacts.values().next().value;
          if (content !== undefined) {
            const targets = new Set(
              planningMembers.flatMap(
                ({ layout }) => getNfoWritePaths(layout.nfoPath, config.download.nfoNaming).requiredPaths,
              ),
            );
            for (const targetPath of targets) await writeFile(targetPath, content);
          }
          return savedNfoPath;
        },
      });
      const members = planningMembers.map((member): UncensoredConfirmedMember<TContext> => {
        const publicationFile = publication.output.files.find((file) => file.fileId === member.item.fileId);
        if (!publicationFile) throw new Error(`Uncensored publication omitted selected file: ${member.item.fileId}`);
        return {
          item: member.item,
          publicationFile,
          sourceNfoPath: member.existingNfoPath,
          nfoPath: publication.nfoPath
            ? getNfoWritePaths(member.layout.nfoPath, config.download.nfoNaming).canonicalPath
            : undefined,
        };
      });
      await dependencies.publish({ operationId, output: publication.output, members });
      for (const member of members) {
        updatedItems.push({
          fileId: member.item.fileId,
          sourceVideoPath: member.item.videoPath,
          sourceNfoPath: member.sourceNfoPath,
          targetVideoPath: publication.resolve(member.publicationFile.target),
          targetNfoPath: member.nfoPath,
          choice: member.item.choice,
        });
        dependencies.logger.info(`Updated uncensored choice to "${member.item.choice}" for ${member.item.videoPath}`);
      }
    } catch (error) {
      for (const processed of processedItems)
        fail(processed.item, `Failed to finalize ${processed.item.videoPath}: ${toErrorMessage(error)}`);
    }
  }

  return { updatedCount: updatedItems.length, items: updatedItems, failures };
};

import { dirname } from "node:path";
import { type MediaRoot, resolveRootFile, resolveRootRelativePath, toRootRelativePath } from "@mdcz/media-store";
import type { Configuration } from "@mdcz/shared/config";
import { toErrorMessage } from "@mdcz/shared/error";
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
import type { LocalScanService } from "../maintenance/LocalScanService";
import { buildMovieTags } from "../maintenance/movieTags";
import { type PreparedPublicationPlan, preparePublicationPlan } from "../publication";
import { publicationPathKey } from "../publication/boundary";
import type { RuntimeLogger } from "../shared";
import type { FileOrganizer, OrganizePlan } from "./FileOrganizer";
import { type NfoGenerator, nfoIgnoreFieldsToEnabledFields } from "./nfo";
import { parseFileInfo } from "./utils/number";

export interface RuntimeUncensoredConfirmItem {
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

export type UncensoredConfirmUpdate = UncensoredConfirmResultItem & {
  assets: DiscoveredAssets;
  outputAssets: PreparedPublicationPlan["assets"];
  removedAssetPaths: string[];
};

export interface RuntimeUncensoredConfirmResult {
  updatedCount: number;
  items: UncensoredConfirmUpdate[];
  failures: RuntimeUncensoredConfirmFailure[];
}

interface PreparedUncensoredConfirmItem {
  item: RuntimeUncensoredConfirmItem;
  entry: LocalScanEntry;
  effectiveNfoPath?: string;
  nextLocalState: NfoLocalState;
}

export interface UncensoredConfirmDependencies {
  fileOrganizer: Pick<FileOrganizer, "plan" | "resolveOutputPlan">;
  localScanService: Pick<LocalScanService, "scanVideo">;
  logger: Pick<RuntimeLogger, "info" | "warn">;
  nfoGenerator: Pick<NfoGenerator, "writeNfo">;
  pathExists: (filePath: string) => Promise<boolean>;
  /**
   * `updates` describes what the batch is about to write, so hosts can stage
   * their business revisions and hand them to the publication commit hook.
   */
  publish(input: {
    operationId: string;
    plan: PreparedPublicationPlan;
    updates: readonly UncensoredConfirmUpdate[];
  }): Promise<void>;
}

export interface UncensoredRevisionSources {
  update: UncensoredConfirmUpdate;
  outcome: { id: string; crawlerDataJson: string | null };
  roots: readonly Pick<MediaRoot, "id" | "hostPath">[];
  entry: {
    crawlerDataJson: string | null;
    files: Array<{
      id: string;
      sourceOutcomeId: string | null;
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
    assets: Array<{ kind: string; uri: string; rootId: string | null; relativePath: string | null }>;
  };
  size: number;
  modifiedAt: Date | null;
}

/**
 * Both hosts persist the same facts after a confirmation, so the mapping from
 * published paths to outcome and library revisions lives here rather than being
 * mirrored in the desktop and server services.
 */
export const buildUncensoredRevision = (sources: UncensoredRevisionSources) => {
  const { update, outcome, entry, size, modifiedAt } = sources;
  const file = entry.files.find((file) => file.sourceOutcomeId === outcome.id);
  if (!file) throw new Error("无码确认来源已不属于影片文件");
  const outputRoot = resolveRootFile(sources.roots, update.targetVideoPath).root;
  const nfo = update.targetNfoPath ? resolveRootFile(sources.roots, update.targetNfoPath) : undefined;
  const outputRelativePath = toRootRelativePath(outputRoot, update.targetVideoPath);
  const nfoRelativePath = nfo?.relativePath ?? null;
  const crawlerDataJson = entry.crawlerDataJson;
  if (!crawlerDataJson) throw new Error("影片缺少当前元数据，无法确认无码类型");
  const crawlerData = crawlerDataSchema.parse(JSON.parse(crawlerDataJson));
  const updatedAssets = update.outputAssets.map((asset) => {
    const resolved = asset.targetPath ? resolveRootFile(sources.roots, asset.targetPath) : undefined;
    const relativePath = resolved?.relativePath ?? null;
    return {
      kind: asset.kind,
      uri: relativePath ?? (asset.url as string),
      rootId: resolved?.root.id ?? null,
      relativePath,
    };
  });
  const removed = new Set(update.removedAssetPaths.map(publicationPathKey));
  const updatedKinds = new Set([
    "thumb",
    "poster",
    "fanart",
    "trailer",
    "scene",
    "actor",
    ...updatedAssets.map((asset) => asset.kind),
  ]);
  const retainedAssets = entry.assets.filter((asset) => {
    if (updatedKinds.has(asset.kind)) return false;
    if (!asset.rootId || !asset.relativePath) return true;
    const root = sources.roots.find((root) => root.id === asset.rootId);
    if (!root) throw new Error(`Resource root not found: ${asset.rootId}`);
    return !removed.has(publicationPathKey(resolveRootRelativePath(root, asset.relativePath)));
  });
  return {
    outcomeId: outcome.id,
    crawlerDataJson,
    nfoRootId: nfo && nfo.root.id !== outputRoot.id ? nfo.root.id : null,
    nfoRelativePath,
    outputRootId: outputRoot.id,
    outputRelativePath,
    uncensoredAmbiguous: false,
    size,
    modifiedAt,
    libraryEntry: {
      id: entry.id,
      fileId: file.id,
      sourceOutcomeId: outcome.id,
      partNumber: file.partNumber,
      partSuffix: file.partSuffix,
      resolution: file.resolution,
      rootId: outputRoot.id,
      rootRelativePath: outputRelativePath,
      mediaIdentity: entry.mediaIdentity,
      size,
      modifiedAt,
      title: entry.title ?? crawlerData.title,
      number: entry.number ?? crawlerData.number,
      actors: entry.actors,
      crawlerDataJson,
      assets: [...retainedAssets, ...updatedAssets],
      lastKnownPath: outputRelativePath,
      createdAt: entry.createdAt,
      lastRefreshedAt: new Date(),
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

export const confirmUncensoredOutputs = async (
  items: RuntimeUncensoredConfirmItem[],
  config: Configuration,
  dependencies: UncensoredConfirmDependencies,
): Promise<RuntimeUncensoredConfirmResult> => {
  const updatedItems: UncensoredConfirmUpdate[] = [];
  const failures: RuntimeUncensoredConfirmFailure[] = [];
  const preparedItems: PreparedUncensoredConfirmItem[] = [];
  const choices = new Map<string, UncensoredChoice>();
  for (const item of items) {
    const key = item.groupId;
    if (choices.has(key) && choices.get(key) !== item.choice) throw new Error("同一影片不能选择不同的无码类型");
    choices.set(key, item.choice);
  }
  const fail = (item: RuntimeUncensoredConfirmItem, message: string): void => {
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

  const batches = new Map<string, PreparedUncensoredConfirmItem[]>();
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
      for (const prepared of batchItems) fail(prepared.item, "影片中有文件不可用，未修改任何文件");
      continue;
    }
    const processedItems: Array<PreparedUncensoredConfirmItem & { outputVideoPath: string; plan: OrganizePlan }> = [];
    for (const prepared of batchItems) {
      try {
        const rawPlan = dependencies.fileOrganizer.plan(
          prepared.entry.fileInfo,
          prepared.entry.crawlerData as CrawlerData,
          config,
          prepared.nextLocalState,
        );
        const plan = await dependencies.fileOrganizer.resolveOutputPlan(rawPlan, prepared.entry.fileInfo.filePath);
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
      const finalizedItems = [];
      for (const processed of processedItems) {
        const publication = await preparePublicationPlan({
          files: [
            {
              sourceVideoPath: processed.item.videoPath,
              outputVideoPath: processed.outputVideoPath,
              organizePlan: processed.plan,
            },
          ],
          existingAssetDir: dirname(
            processed.effectiveNfoPath ?? processed.item.metadataVideoPath ?? processed.item.videoPath,
          ),
          metadataOutputDir: processed.plan.metadataDir ?? processed.plan.outputDir,
          downloadedAssets: { downloaded: [], sceneImages: [] },
          actorPhotoPaths: [],
          existingAssets: processed.entry.assets,
          existingNfoPath: processed.effectiveNfoPath,
          organizeFiles: !config.behavior.metadataOnly,
          renameSubtitles: !config.behavior.metadataOnly && config.behavior.successFileRename,
          nfoNaming: config.download.nfoNaming,
          strmPathMappings: config.paths.strmPathMappings,
          writeNfo: async (_assets, writeFile) => {
            for (const [targetPath, content] of nfoArtifacts) await writeFile(targetPath, content);
            return savedNfoPath;
          },
        });
        finalizedItems.push({ processed, publication });
      }
      const plans = finalizedItems.map(({ publication }) => publication.plan);
      const boundaries = plans.flatMap((plan) => (plan.boundary ? [plan.boundary] : []));
      const boundary = boundaries.length
        ? {
            writeRoots: boundaries.flatMap((value) => value.writeRoots),
            writablePaths: boundaries.flatMap((value) => value.writablePaths),
            readOnlyPaths: boundaries.flatMap((value) => value.readOnlyPaths),
            readOnlyDirectories: boundaries.flatMap((value) => value.readOnlyDirectories),
          }
        : undefined;
      const moves = new Map<string, NonNullable<PreparedPublicationPlan["sidecars"]>[number]>();
      const artifacts = new Map<string, PreparedPublicationPlan["artifacts"][number]>();
      for (const plan of plans) {
        for (const move of plan.sidecars ?? []) {
          const previous = moves.get(move.targetPath);
          if (previous && previous.sourcePath !== move.sourcePath)
            throw new Error(`Conflicting batch sources: ${move.targetPath}`);
          moves.set(move.targetPath, move);
        }
        for (const artifact of plan.artifacts) {
          const previous = artifacts.get(artifact.targetPath);
          if (previous) {
            const sameContent =
              previous.content.kind === artifact.content.kind &&
              (previous.content.kind === "file" && artifact.content.kind === "file"
                ? previous.content.path === artifact.content.path && previous.content.size === artifact.content.size
                : previous.content.kind !== "file" &&
                  artifact.content.kind !== "file" &&
                  Buffer.from(previous.content.data).equals(Buffer.from(artifact.content.data)));
            if (!sameContent) throw new Error(`Conflicting batch artifacts: ${artifact.targetPath}`);
          }
          artifacts.set(artifact.targetPath, artifact);
        }
      }
      const confirmed: UncensoredConfirmUpdate[] = finalizedItems.map(({ processed, publication }) => ({
        fileId: processed.item.fileId,
        sourceVideoPath: processed.item.videoPath,
        sourceNfoPath: processed.effectiveNfoPath,
        targetVideoPath: processed.outputVideoPath,
        targetNfoPath: publication.nfoPath,
        choice: processed.item.choice,
        assets: publication.assets,
        outputAssets: publication.plan.assets,
        removedAssetPaths: [
          ...publication.plan.obsoletePaths,
          ...(publication.plan.sidecars ?? [])
            .filter((move) => move.sourcePath !== move.targetPath)
            .map((move) => move.sourcePath),
        ],
      }));
      await dependencies.publish({
        operationId: `uncensored-confirm:${processedItems.map(({ item }) => item.fileId).join(":")}`,
        plan: {
          media: plans.flatMap((plan) => plan.media ?? []),
          boundary,
          videos: plans.flatMap((plan) => plan.videos ?? []),
          sidecars: [...moves.values()],
          artifacts: [...artifacts.values()],
          assets: plans.flatMap((plan) => plan.assets),
          obsoletePaths: [],
          replaceExistingTargetPaths: [...new Set(plans.flatMap((plan) => plan.replaceExistingTargetPaths ?? []))],
        },
        updates: confirmed,
      });
      for (const update of confirmed) {
        updatedItems.push(update);
        dependencies.logger.info(`Updated uncensored choice to "${update.choice}" for ${update.sourceVideoPath}`);
      }
    } catch (error) {
      for (const processed of processedItems)
        fail(processed.item, `Failed to finalize ${processed.item.videoPath}: ${toErrorMessage(error)}`);
    }
  }

  return { updatedCount: updatedItems.length, items: updatedItems, failures };
};

import { dirname } from "node:path";
import type { Configuration } from "@mdcz/shared/config";
import { toErrorMessage } from "@mdcz/shared/error";
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
import { LocalScanService } from "../maintenance/LocalScanService";
import { MaintenanceArtifactResolver } from "../maintenance/MaintenanceArtifactResolver";
import { noopRuntimeLogger, type RuntimeLogger } from "../shared";
import { FileOrganizer, type OrganizePlan } from "./FileOrganizer";
import { NfoGenerator, nfoIgnoreFieldsToEnabledFields } from "./nfo";
import { pathExists } from "./utils/filesystem";
import { parseFileInfo } from "./utils/number";

export interface RuntimeUncensoredConfirmItem {
  fileId: FileId;
  videoPath: string;
  metadataVideoPath?: string;
  nfoPath?: string;
  crawlerData?: CrawlerData;
  choice: UncensoredChoice;
}

export interface RuntimeUncensoredConfirmFailure {
  fileId: FileId;
  videoPath: string;
  message: string;
}

export interface RuntimeUncensoredConfirmResult {
  updatedCount: number;
  items: Array<UncensoredConfirmResultItem & { assets: DiscoveredAssets }>;
  failures: RuntimeUncensoredConfirmFailure[];
}

interface PreparedUncensoredConfirmItem {
  item: RuntimeUncensoredConfirmItem;
  entry: LocalScanEntry;
  effectiveNfoPath: string;
  nextLocalState: NfoLocalState;
}

export interface UncensoredConfirmDependencies {
  artifactResolver: Pick<MaintenanceArtifactResolver, "resolve">;
  fileOrganizer: Pick<FileOrganizer, "ensureOutputReady" | "organizeVideo" | "plan">;
  localScanService: Pick<LocalScanService, "scanVideo">;
  logger: Pick<RuntimeLogger, "info" | "warn">;
  nfoGenerator: Pick<NfoGenerator, "writeNfo">;
  pathExists: typeof pathExists;
}

const buildBatchKey = (nfoPath: string, choice: UncensoredChoice): string => `${nfoPath.trim()}::${choice}`;

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

const defaultDependencies = (): UncensoredConfirmDependencies => ({
  artifactResolver: new MaintenanceArtifactResolver(),
  fileOrganizer: new FileOrganizer(),
  localScanService: new LocalScanService(),
  logger: noopRuntimeLogger,
  nfoGenerator: new NfoGenerator(),
  pathExists,
});

export const confirmUncensoredOutputs = async (
  items: RuntimeUncensoredConfirmItem[],
  config: Configuration,
  dependencies: UncensoredConfirmDependencies = defaultDependencies(),
): Promise<RuntimeUncensoredConfirmResult> => {
  const updatedItems: Array<UncensoredConfirmResultItem & { assets: DiscoveredAssets }> = [];
  const failures: RuntimeUncensoredConfirmFailure[] = [];
  const preparedItems: PreparedUncensoredConfirmItem[] = [];
  const fail = (item: RuntimeUncensoredConfirmItem, message: string): void => {
    dependencies.logger.warn(message);
    failures.push({ fileId: item.fileId, videoPath: item.videoPath, message });
  };

  for (const item of items) {
    try {
      const nfoPath = item.nfoPath?.trim();
      const videoPath = item.videoPath.trim();
      if (
        !nfoPath ||
        !videoPath ||
        !(await dependencies.pathExists(nfoPath)) ||
        !(await dependencies.pathExists(videoPath))
      ) {
        fail(item, `Skipping uncensored confirm: output files not found for ${videoPath || nfoPath}`);
        continue;
      }

      const scannedEntry = await dependencies.localScanService.scanVideo(
        item.metadataVideoPath?.trim() || videoPath,
        config.paths.sceneImagesFolder,
      );
      const effectiveNfoPath = scannedEntry.nfoPath ?? nfoPath;
      const crawlerData = item.crawlerData ?? scannedEntry.crawlerData;
      if (!effectiveNfoPath || !crawlerData || !(await dependencies.pathExists(effectiveNfoPath))) {
        fail(item, `Skipping uncensored confirm: incomplete local output for ${videoPath}`);
        continue;
      }

      const entry = {
        ...scannedEntry,
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
  const choicesByNfoPath = new Map<string, Set<UncensoredChoice>>();
  for (const prepared of preparedItems) {
    const choices = choicesByNfoPath.get(prepared.effectiveNfoPath) ?? new Set<UncensoredChoice>();
    choices.add(prepared.item.choice);
    choicesByNfoPath.set(prepared.effectiveNfoPath, choices);
  }
  for (const prepared of preparedItems) {
    if ((choicesByNfoPath.get(prepared.effectiveNfoPath)?.size ?? 0) > 1) {
      fail(prepared.item, `Conflicting uncensored choices for shared NFO: ${prepared.effectiveNfoPath}`);
      continue;
    }
    const key = buildBatchKey(prepared.effectiveNfoPath, prepared.item.choice);
    batches.set(key, [...(batches.get(key) ?? []), prepared]);
  }

  for (const batchItems of batches.values()) {
    const processedItems: Array<PreparedUncensoredConfirmItem & { outputVideoPath: string; plan: OrganizePlan }> = [];
    for (const prepared of batchItems) {
      try {
        const rawPlan = dependencies.fileOrganizer.plan(
          prepared.entry.fileInfo,
          prepared.entry.crawlerData as CrawlerData,
          config,
          prepared.nextLocalState,
        );
        const plan = await dependencies.fileOrganizer.ensureOutputReady(rawPlan, prepared.entry.fileInfo.filePath);
        const outputVideoPath = await dependencies.fileOrganizer.organizeVideo(prepared.entry.fileInfo, plan, config);
        processedItems.push({ ...prepared, outputVideoPath, plan });
      } catch (error) {
        fail(prepared.item, `Failed to reorganize ${prepared.item.videoPath}: ${toErrorMessage(error)}`);
      }
    }
    if (processedItems.length === 0) continue;

    let savedNfoPath: string;
    try {
      const seed = processedItems[0];
      savedNfoPath = await dependencies.nfoGenerator.writeNfo(
        seed.plan.nfoPath,
        seed.entry.crawlerData as CrawlerData,
        {
          fileInfo: buildSharedFileInfo(
            processedItems.map((item) => item.entry),
            seed.outputVideoPath,
          ),
          localState: seed.nextLocalState,
          nfoNaming: config.download.nfoNaming,
          enabledFields: nfoIgnoreFieldsToEnabledFields(config.download.nfoIgnoreFields),
          nfoTitleTemplate: config.naming.nfoTitleTemplate,
        },
      );
    } catch (error) {
      const message = `Failed to write uncensored confirmation NFO: ${toErrorMessage(error)}`;
      for (const processed of processedItems) fail(processed.item, message);
      continue;
    }

    for (const processed of processedItems) {
      try {
        const artifacts = await dependencies.artifactResolver.resolve({
          entry: { ...processed.entry, nfoLocalState: processed.nextLocalState },
          plan: processed.plan,
          outputVideoPath: processed.outputVideoPath,
          savedNfoPath,
          nfoNaming: config.download.nfoNaming,
        });
        updatedItems.push({
          fileId: processed.item.fileId,
          sourceVideoPath: processed.item.videoPath,
          sourceNfoPath: processed.effectiveNfoPath,
          targetVideoPath: processed.outputVideoPath,
          targetNfoPath: artifacts.nfoPath,
          choice: processed.item.choice,
          assets: artifacts.assets,
        });
        dependencies.logger.info(
          `Updated uncensored choice to "${processed.item.choice}" for ${processed.item.videoPath}`,
        );
      } catch (error) {
        fail(processed.item, `Failed to finalize ${processed.item.videoPath}: ${toErrorMessage(error)}`);
      }
    }
  }

  return { updatedCount: updatedItems.length, items: updatedItems, failures };
};

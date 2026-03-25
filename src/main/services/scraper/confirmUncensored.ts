import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import { fileOrganizer } from "@main/services/scraper/FileOrganizer";
import { LocalScanService } from "@main/services/scraper/maintenance/LocalScanService";
import { MaintenanceArtifactResolver } from "@main/services/scraper/maintenance/MaintenanceArtifactResolver";
import { nfoGenerator } from "@main/services/scraper/NfoGenerator";
import { toErrorMessage } from "@main/utils/common";
import { pathExists } from "@main/utils/file";
import type {
  DownloadedAssets,
  FileInfo,
  LocalScanEntry,
  NfoLocalState,
  UncensoredChoice,
  UncensoredConfirmItem,
  UncensoredConfirmResultItem,
} from "@shared/types";

const logger = loggerService.getLogger("ConfirmUncensored");
const localScanService = new LocalScanService();
const artifactResolver = new MaintenanceArtifactResolver();

const EMPTY_DOWNLOADED_ASSETS = (): DownloadedAssets => ({
  sceneImages: [],
  downloaded: [],
});

interface PreparedUncensoredConfirmItem {
  item: UncensoredConfirmItem;
  entry: LocalScanEntry;
  effectiveNfoPath: string;
  nextLocalState: NfoLocalState;
}

interface UncensoredConfirmDependencies {
  artifactResolver: Pick<MaintenanceArtifactResolver, "resolve">;
  fileOrganizer: Pick<typeof fileOrganizer, "ensureOutputReady" | "organizeVideo" | "plan">;
  localScanService: Pick<LocalScanService, "scanVideo">;
  logger: Pick<typeof logger, "info" | "warn">;
  nfoGenerator: Pick<typeof nfoGenerator, "writeNfo">;
  pathExists: typeof pathExists;
}

const buildUncensoredConfirmBatchKey = (nfoPath: string, choice: UncensoredChoice): string =>
  `${nfoPath.trim()}::${choice}`;

const buildSharedUncensoredConfirmFileInfo = (
  entries: LocalScanEntry[],
  outputVideoPath: string,
): FileInfo | undefined => {
  const firstEntry = entries[0];
  if (!firstEntry) {
    return undefined;
  }

  const subtitleSource = entries.find((entry) => entry.fileInfo.isSubtitled || Boolean(entry.fileInfo.subtitleTag));

  return {
    ...firstEntry.fileInfo,
    filePath: outputVideoPath,
    isSubtitled: entries.some((entry) => entry.fileInfo.isSubtitled),
    subtitleTag: subtitleSource?.fileInfo.subtitleTag,
    part: undefined,
  };
};

const defaultUncensoredConfirmDependencies = (): UncensoredConfirmDependencies => ({
  artifactResolver,
  fileOrganizer,
  localScanService,
  logger,
  nfoGenerator,
  pathExists,
});

export const confirmUncensoredItems = async (
  items: UncensoredConfirmItem[],
  config: Configuration,
  dependencies: UncensoredConfirmDependencies = defaultUncensoredConfirmDependencies(),
): Promise<{ updatedCount: number; items: UncensoredConfirmResultItem[] }> => {
  let updatedCount = 0;
  const updatedItems: UncensoredConfirmResultItem[] = [];
  const preparedItems: PreparedUncensoredConfirmItem[] = [];

  for (const item of items) {
    try {
      const nfoPath = item.nfoPath?.trim();
      const videoPath = item.videoPath?.trim();
      if (
        !nfoPath ||
        !videoPath ||
        !(await dependencies.pathExists(nfoPath)) ||
        !(await dependencies.pathExists(videoPath))
      ) {
        dependencies.logger.warn(`Skipping uncensored confirm: source files not found for ${videoPath || nfoPath}`);
        continue;
      }

      const entry = await dependencies.localScanService.scanVideo(videoPath, config.paths.sceneImagesFolder);
      const effectiveNfoPath = entry.nfoPath ?? nfoPath;
      if (!effectiveNfoPath || !entry.crawlerData || !(await dependencies.pathExists(effectiveNfoPath))) {
        dependencies.logger.warn(`Skipping uncensored confirm: incomplete local scan for ${videoPath}`);
        continue;
      }

      const nextLocalState = {
        ...entry.nfoLocalState,
        uncensoredChoice: item.choice,
      };
      preparedItems.push({
        item,
        entry,
        effectiveNfoPath,
        nextLocalState,
      });
    } catch (error) {
      dependencies.logger.warn(`Failed to update uncensored tag for ${item.videoPath}: ${toErrorMessage(error)}`);
    }
  }

  const itemsByBatchKey = new Map<string, PreparedUncensoredConfirmItem[]>();
  for (const prepared of preparedItems) {
    const key = buildUncensoredConfirmBatchKey(prepared.effectiveNfoPath, prepared.item.choice);
    const batch = itemsByBatchKey.get(key);
    if (batch) {
      batch.push(prepared);
      continue;
    }

    itemsByBatchKey.set(key, [prepared]);
  }

  for (const batchItems of itemsByBatchKey.values()) {
    const processedItems: Array<
      PreparedUncensoredConfirmItem & {
        outputVideoPath: string;
        plan: Awaited<ReturnType<typeof fileOrganizer.ensureOutputReady>>;
      }
    > = [];

    for (const prepared of batchItems) {
      try {
        const rawPlan = dependencies.fileOrganizer.plan(
          prepared.entry.fileInfo,
          prepared.entry.crawlerData as NonNullable<LocalScanEntry["crawlerData"]>,
          config,
          prepared.nextLocalState,
        );
        const plan = await dependencies.fileOrganizer.ensureOutputReady(rawPlan, prepared.entry.fileInfo.filePath);
        const outputVideoPath = await dependencies.fileOrganizer.organizeVideo(prepared.entry.fileInfo, plan, config);
        processedItems.push({
          ...prepared,
          outputVideoPath,
          plan,
        });
      } catch (error) {
        dependencies.logger.warn(
          `Failed to update uncensored tag for ${prepared.item.videoPath}: ${toErrorMessage(error)}`,
        );
      }
    }

    if (processedItems.length === 0) {
      continue;
    }

    let savedNfoPath: string | undefined;
    try {
      const sharedSeed = processedItems[0];
      const sharedFileInfo = buildSharedUncensoredConfirmFileInfo(
        processedItems.map((item) => item.entry),
        sharedSeed.outputVideoPath,
      );
      savedNfoPath = await dependencies.nfoGenerator.writeNfo(
        sharedSeed.plan.nfoPath,
        sharedSeed.entry.crawlerData as NonNullable<LocalScanEntry["crawlerData"]>,
        {
          fileInfo: sharedFileInfo,
          localState: sharedSeed.nextLocalState,
        },
      );
    } catch (error) {
      const choice = batchItems[0]?.item.choice ?? "uncensored";
      dependencies.logger.warn(
        `Failed to write shared uncensored NFO for choice "${choice}": ${toErrorMessage(error)}`,
      );
      continue;
    }

    for (const processed of processedItems) {
      try {
        const resolvedArtifacts = await dependencies.artifactResolver.resolve({
          entry: {
            ...processed.entry,
            nfoLocalState: processed.nextLocalState,
          },
          plan: processed.plan,
          outputVideoPath: processed.outputVideoPath,
          assets: EMPTY_DOWNLOADED_ASSETS(),
          savedNfoPath,
        });

        updatedCount += 1;
        updatedItems.push({
          sourceVideoPath: processed.item.videoPath,
          sourceNfoPath: processed.effectiveNfoPath,
          targetVideoPath: processed.outputVideoPath,
          targetNfoPath: resolvedArtifacts.nfoPath,
          choice: processed.item.choice,
        });
        dependencies.logger.info(
          `Updated uncensored choice to "${processed.item.choice}" for ${processed.item.videoPath}`,
        );
      } catch (error) {
        dependencies.logger.warn(
          `Failed to finalize uncensored tag update for ${processed.item.videoPath}: ${toErrorMessage(error)}`,
        );
      }
    }
  }

  return { updatedCount, items: updatedItems };
};

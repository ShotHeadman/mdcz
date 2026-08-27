import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import { fileOrganizer } from "@main/services/scraper/FileScraper";
import { nfoGenerator } from "@main/services/scraper/NfoGenerator";
import { pathExists } from "@main/utils/file";
import { LocalScanService } from "@mdcz/runtime/maintenance";
import { MaintenanceArtifactResolver } from "@mdcz/runtime/maintenance/MaintenanceArtifactResolver";
import { commitAbsolutePublication } from "@mdcz/runtime/publication";
import { confirmUncensoredOutputs, type UncensoredConfirmDependencies } from "@mdcz/runtime/scrape";
import type { UncensoredConfirmItem, UncensoredConfirmResultItem } from "@mdcz/shared/types";

const logger = loggerService.getLogger("ConfirmUncensored");

const defaultDependencies = (): UncensoredConfirmDependencies => ({
  artifactResolver: new MaintenanceArtifactResolver(),
  fileOrganizer,
  localScanService: new LocalScanService(),
  logger,
  nfoGenerator,
  pathExists,
  publish: async ({
    operationId,
    sourceVideoPath,
    targetVideoPath,
    artifacts,
    obsoletePaths,
    replaceExistingArtifacts,
  }) => {
    await commitAbsolutePublication({
      operationId,
      operationType: "maintenance",
      sourceVideoPath,
      targetVideoPath,
      artifacts,
      obsoletePaths,
      replaceExistingArtifacts,
    });
  },
});

export const confirmUncensoredItems = async (
  items: UncensoredConfirmItem[],
  config: Configuration,
  dependencies: UncensoredConfirmDependencies = defaultDependencies(),
): Promise<{ updatedCount: number; items: UncensoredConfirmResultItem[] }> => {
  const result = await confirmUncensoredOutputs(items, config, dependencies);
  return {
    updatedCount: result.updatedCount,
    items: result.items.map(({ assets: _assets, ...item }) => item),
  };
};

import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import { fileOrganizer } from "@main/services/scraper/FileScraper";
import { pathExists } from "@main/utils/file";
import { LocalScanService } from "@mdcz/runtime/maintenance";
import { MaintenanceArtifactResolver } from "@mdcz/runtime/maintenance/MaintenanceArtifactResolver";
import { commitRegisteredPublication, type RegisteredPublicationContext } from "@mdcz/runtime/publication";
import { confirmUncensoredOutputs, nfoGenerator, type UncensoredConfirmDependencies } from "@mdcz/runtime/scrape";
import type { UncensoredConfirmItem, UncensoredConfirmResultItem } from "@mdcz/shared/types";

const logger = loggerService.getLogger("ConfirmUncensored");

export const createUncensoredConfirmDependencies = (
  publication: RegisteredPublicationContext,
): UncensoredConfirmDependencies => ({
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
    await commitRegisteredPublication(
      {
        operationId,
        operationType: "maintenance",
        sourceVideoPath,
        targetVideoPath,
        artifacts,
        obsoletePaths,
        replaceExistingArtifacts,
      },
      publication,
    );
  },
});

export const confirmUncensoredItems = async (
  items: UncensoredConfirmItem[],
  config: Configuration,
  dependencies: UncensoredConfirmDependencies,
): Promise<{ updatedCount: number; items: UncensoredConfirmResultItem[] }> => {
  const result = await confirmUncensoredOutputs(items, config, dependencies);
  return {
    updatedCount: result.updatedCount,
    items: result.items.map(({ assets: _assets, ...item }) => item),
  };
};

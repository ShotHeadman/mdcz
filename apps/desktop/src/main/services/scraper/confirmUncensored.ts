import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import type { DesktopPersistenceState } from "@main/services/persistence";
import { pathExists } from "@main/utils/file";
import type { ScrapeRunManifest } from "@mdcz/persistence";
import { LocalScanService } from "@mdcz/runtime/maintenance";
import { confirmUncensoredRunItems as confirmRunItems, FileOrganizer, nfoGenerator } from "@mdcz/runtime/scrape";
import type { UncensoredChoice, UncensoredConfirmResponse } from "@mdcz/shared/types";

export const confirmUncensoredRunItems = async (input: {
  manifest: ScrapeRunManifest;
  items: readonly { itemId: string; choice: UncensoredChoice }[];
  configuration: Configuration;
  state: DesktopPersistenceState;
}): Promise<UncensoredConfirmResponse> => {
  const { repositories } = input.state;
  const confirmation = await confirmRunItems({
    ...input,
    roots: await repositories.mediaRoots.list(),
    repositories: {
      library: repositories.library,
      scrapeRuns: repositories.scrapeRuns,
      journal: repositories.publicationJournal,
      repairIssues: repositories.libraryRepairIssues,
    },
    dependencies: {
      fileOrganizer: new FileOrganizer(loggerService.getLogger("FileOrganizer")),
      localScanService: new LocalScanService(),
      logger: loggerService.getLogger("ConfirmUncensored"),
      nfoGenerator,
      pathExists,
    },
  });
  return {
    updatedCount: confirmation.updatedCount,
    items: confirmation.items,
  };
};

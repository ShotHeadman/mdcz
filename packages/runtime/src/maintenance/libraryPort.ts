import type { MediaRoot } from "@mdcz/media-store";
import { mediaPathOwnership } from "../library/mediaPathOwnership";
import { createPublicationPlan } from "../publication/createPublicationPlan";
import { commitPublishedMedia } from "../publication/publishMedia";
import type { PublicationJournalPort, PublicationRepairPort } from "../publication/types";
import type { MaintenanceLibraryPort } from "./coordinator";

export const createMaintenanceLibraryPort = <TPrepared>(deps: {
  getRepositories: () => Promise<{
    library: {
      resolveMaintenanceSource: MaintenanceLibraryPort["resolveSource"];
      preflightMaintenanceRefresh: MaintenanceLibraryPort["preflightRefresh"];
      prepareRefresh: (input: Parameters<MaintenanceLibraryPort["publishRefresh"]>[0]["refresh"]) => Promise<TPrepared>;
      writeRefresh: (prepared: TPrepared) => { libraryItemId: string };
    };
    mediaRoots: { list(): Promise<readonly Pick<MediaRoot, "id" | "hostPath">[]> };
    publicationJournal: PublicationJournalPort;
    libraryRepairIssues?: PublicationRepairPort;
  }>;
  resolveRoot: (rootId: string) => Promise<Pick<MediaRoot, "id" | "hostPath">>;
}): MaintenanceLibraryPort => ({
  resolveSource: async (absolutePath) => (await deps.getRepositories()).library.resolveMaintenanceSource(absolutePath),
  preflightRefresh: async (input) => (await deps.getRepositories()).library.preflightMaintenanceRefresh(input),
  publishRefresh: async (input) => {
    const state = await deps.getRepositories();
    const refresh = await state.library.prepareRefresh(input.refresh);
    const plan = createPublicationPlan(input.operationId, "maintenance", input.plan, await state.mediaRoots.list());
    return await commitPublishedMedia(plan, {
      resolveRoot: deps.resolveRoot,
      acquireAll: (refs) => mediaPathOwnership.acquireAll(refs, input.ownershipToken),
      journal: state.publicationJournal,
      repairIssues: state.libraryRepairIssues,
      commit: () => state.library.writeRefresh(refresh),
    });
  },
});

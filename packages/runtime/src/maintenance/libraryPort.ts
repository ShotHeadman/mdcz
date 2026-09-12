import { type MediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import { mediaPathOwnership } from "../library/mediaPathOwnership";
import { createPublicationPlan } from "../publication/createPublicationPlan";
import { commitPublishedMedia } from "../publication/publishMedia";
import { registeredMediaLocations } from "../publication/registeredOutputs";
import type { PublicationJournalPort, PublicationOutputPort, PublicationRepairPort } from "../publication/types";
import type { MaintenanceLibraryPort } from "./coordinator";

export const createMaintenanceLibraryPort = <TPrepared>(deps: {
  getRepositories: () => Promise<{
    library: PublicationOutputPort & {
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
  registeredOutputs: async (paths) =>
    registeredMediaLocations((await deps.getRepositories()).library, deps.resolveRoot, paths),
  resolveSource: async (absolutePath) => (await deps.getRepositories()).library.resolveMaintenanceSource(absolutePath),
  preflightRefresh: async (input) => (await deps.getRepositories()).library.preflightMaintenanceRefresh(input),
  publishRefresh: async (input) => {
    const state = await deps.getRepositories();
    const roots = await state.mediaRoots.list();
    input.resolvedPlan ??= createPublicationPlan(input.operationId, "maintenance", input.plan, roots);
    const plan = input.resolvedPlan;
    const video = plan.media?.[0];
    if (video) {
      const root = roots.find((root) => root.id === video.target.rootId);
      if (!root) throw new Error("Maintenance output root disappeared");
      input.refresh.targetAbsolutePath = resolveRootRelativePath(root, video.target.relativePath);
      input.refresh.size = video.size;
    }
    const refresh = await state.library.prepareRefresh({
      ...input.refresh,
      removedAssets: [
        ...plan.obsolete,
        ...(plan.sidecars ?? [])
          .filter(
            (move) =>
              move.source.rootId !== move.target.rootId || move.source.relativePath !== move.target.relativePath,
          )
          .map((move) => move.source),
      ],
      outputAssets: plan.assets.flatMap((asset) =>
        asset.type === "local" && ["nfo", "strm", "subtitle"].includes(asset.kind)
          ? [{ kind: asset.kind, ...asset.file }]
          : [],
      ),
    });
    return await commitPublishedMedia(plan, {
      resolveRoot: deps.resolveRoot,
      acquireAll: (refs) => mediaPathOwnership.acquireAll(refs, input.ownershipToken),
      journal: state.publicationJournal,
      outputs: state.library,
      repairIssues: state.libraryRepairIssues,
      commit: () => state.library.writeRefresh(refresh),
    });
  },
});

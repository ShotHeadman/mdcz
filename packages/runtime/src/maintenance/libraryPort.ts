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
    const files = input.refresh.files.map((file, index) => {
      const video = plan.media?.[index];
      if (!video) return file;
      const root = roots.find((root) => root.id === video.target.rootId);
      if (!root) throw new Error("Maintenance output root disappeared");
      return {
        ...file,
        targetAbsolutePath: resolveRootRelativePath(root, video.target.relativePath),
        size: video.size,
      };
    });
    const commonOutputs = plan.assets.flatMap((asset) =>
      asset.type === "local" && asset.kind === "nfo" ? [{ kind: asset.kind, ...asset.file }] : [],
    );
    for (const asset of plan.assets) {
      if (asset.type !== "local" || (asset.kind !== "strm" && asset.kind !== "subtitle")) continue;
      const owners = (plan.media ?? []).flatMap((media, index) =>
        media.assets?.some(
          (candidate) =>
            candidate.type === "local" &&
            candidate.kind === asset.kind &&
            candidate.file.rootId === asset.file.rootId &&
            candidate.file.relativePath === asset.file.relativePath,
        )
          ? [index]
          : [],
      );
      if (owners.length === 0 && files.length === 1) owners.push(0);
      if (owners.length !== 1) throw new Error(`维护文件资源缺少唯一文件归属：${asset.file.relativePath}`);
      const owner = files[owners[0] as number];
      if (owner)
        files[owners[0] as number] = {
          ...owner,
          outputAssets: [...(owner.outputAssets ?? []), { kind: asset.kind, ...asset.file }],
        };
    }
    const refresh = await state.library.prepareRefresh({
      ...input.refresh,
      files: files.map((file, index) =>
        index === 0 ? { ...file, outputAssets: [...(file.outputAssets ?? []), ...commonOutputs] } : file,
      ),
      removedAssets: [
        ...plan.obsolete,
        ...(plan.sidecars ?? [])
          .filter(
            (move) =>
              move.source.rootId !== move.target.rootId || move.source.relativePath !== move.target.relativePath,
          )
          .map((move) => move.source),
      ],
    });
    return await commitPublishedMedia(plan, {
      resolveRoot: deps.resolveRoot,
      acquireAll: (keys) => mediaPathOwnership.acquireAll(keys, input.ownershipToken),
      journal: state.publicationJournal,
      outputs: state.library,
      repairIssues: state.libraryRepairIssues,
      validate: async () => {
        for (const file of input.refresh.files) await state.library.preflightMaintenanceRefresh(file);
      },
      commit: () => state.library.writeRefresh(refresh),
    });
  },
});

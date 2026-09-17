import type { MediaRoot } from "@mdcz/media-store";
import { resolveRootRelativePath } from "@mdcz/media-store";
import { mediaPathOwnership } from "../library/mediaPathOwnership";
import { libraryAssetsFromPublicationPlan, type PublicationLibraryAsset } from "../publication/libraryEntry";
import { resolvePublicationParticipants } from "../publication/participants";
import { commitPublishedMedia } from "../publication/publishMedia";
import { registeredMediaLocations } from "../publication/registeredOutputs";
import type { PublicationJournalPort, PublicationOutputPort, PublicationRepairPort } from "../publication/types";
import type { MaintenanceLibraryPort } from "./coordinator";

export const createMaintenanceLibraryPort = (deps: {
  getRepositories: () => Promise<{
    library: PublicationOutputPort & {
      writeEntry(
        movie: {
          id: string;
          mediaIdentity: string;
          title?: string;
          number: string;
          actors?: string[];
          crawlerDataJson?: string;
          lastRefreshedAt: Date;
          assets: PublicationLibraryAsset[];
        },
        files: Array<{
          fileId: string;
          rootId: string;
          rootRelativePath: string;
          size: number;
          modifiedAt: Date;
          assets: PublicationLibraryAsset[];
          lastKnownPath: string;
        }>,
      ): string;
    };
    publicationJournal: PublicationJournalPort;
    libraryRepairIssues?: PublicationRepairPort;
  }>;
  resolveRoot: (rootId: string) => Promise<Pick<MediaRoot, "id" | "hostPath">>;
}): MaintenanceLibraryPort => {
  const resolveParticipants: MaintenanceLibraryPort["resolveParticipants"] = async (
    sources,
    outputs = [],
    identity,
    movieId,
  ) => {
    const state = await deps.getRepositories();
    const paths = await Promise.all(
      [...sources, ...outputs].map(async (source) =>
        resolveRootRelativePath(await deps.resolveRoot(source.rootId), source.relativePath),
      ),
    );
    const snapshot = state.library.publicationSnapshot({ paths, includeOwners: true });
    const features = state.library.publicationSnapshot({ kind: "feature", includeOwners: true });
    const assets = [...snapshot.assets];
    for (const feature of features.assets) {
      if (
        !assets.some(
          (asset) =>
            asset.itemId === feature.itemId &&
            asset.fileId === feature.fileId &&
            asset.kind === feature.kind &&
            asset.rootId === feature.rootId &&
            asset.relativePath === feature.relativePath,
        )
      )
        assets.push(feature);
    }
    const participants = await resolvePublicationParticipants({
      outputs,
      identity,
      movieId,
      members: sources.map(({ fileId, ...source }) => ({ source, fileId })),
      snapshot: { files: snapshot.files, assets },
      resolveRoot: deps.resolveRoot,
    });
    return {
      movieId: participants.movieId,
      files: participants.expected.files.length
        ? participants.expected.files
            .map((file) => {
              if (!file.fileId) throw new Error("Registered maintenance file has no ID");
              return { rootId: file.rootId, relativePath: file.relativePath, fileId: file.fileId };
            })
            .sort((left, right) => left.fileId.localeCompare(right.fileId))
        : participants.members.map(({ source, fileId }) => ({ ...source, fileId })),
      expected: participants.expected,
    };
  };
  return {
    resolveParticipants,
    assertPublication: async (identity, outputs = []) => {
      const current = await resolveParticipants(identity.files, outputs, undefined, identity.movieId);
      if (
        current.movieId !== identity.movieId ||
        current.expected.files.length !== identity.expected.files.length ||
        identity.expected.files.some(
          (file) =>
            !current.expected.files.some(
              (candidate) =>
                candidate.fileId === file.fileId &&
                candidate.itemId === file.itemId &&
                candidate.rootId === file.rootId &&
                candidate.relativePath === file.relativePath,
            ),
        )
      )
        throw new Error("影片关联的视频文件发生变动，请重新预览");
    },
    registeredOutputs: async (paths) =>
      registeredMediaLocations((await deps.getRepositories()).library, deps.resolveRoot, paths),
    publishRefresh: async (input) => {
      const state = await deps.getRepositories();
      const plan = input.plan;
      const files = plan.files.map((file) => ({
        fileId: file.fileId,
        rootId: file.target.rootId,
        rootRelativePath: file.target.relativePath,
        size: file.size,
        modifiedAt: file.modifiedAt,
        assets: libraryAssetsFromPublicationPlan(plan, file.assets),
        lastKnownPath: file.target.relativePath,
      }));
      const crawlerData = input.crawlerData;
      const identity = crawlerData?.number || input.fallbackNumber;
      const movie = {
        id: plan.movieId,
        assets: libraryAssetsFromPublicationPlan(plan, plan.movieAssets),
        mediaIdentity: identity,
        number: identity,
        title: crawlerData?.title,
        actors: crawlerData?.actors,
        crawlerDataJson: crawlerData ? JSON.stringify(crawlerData) : undefined,
        lastRefreshedAt: input.refreshedAt,
      };
      const published = await commitPublishedMedia(plan, {
        resolveRoot: deps.resolveRoot,
        acquireAll: (keys) => mediaPathOwnership.acquireAll(keys, input.ownershipToken),
        journal: state.publicationJournal,
        outputs: state.library,
        repairIssues: state.libraryRepairIssues,
        commit: () => ({ libraryItemId: state.library.writeEntry(movie, files) }),
      });
      return { ...published.value, cleanupIssues: published.cleanupIssues };
    },
  };
};

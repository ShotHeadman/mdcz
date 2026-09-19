import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { MediaRoot } from "@mdcz/media-store";
import { resolveRootRelativePath } from "@mdcz/media-store";
import { mediaPathOwnership } from "../library/mediaPathOwnership";
import { registeredMediaLocations } from "../library/registeredMedia";
import { MoveOutput } from "../publication/MoveOutput";
import { libraryAssetsFromMovieOutput, type PublicationLibraryAsset } from "../publication/outputLibrary";
import type {
  PublicationJournalPort,
  PublicationOutputPort,
  PublicationRepairPort,
  PublicationResult,
} from "../publication/types";
import { WriteOutput } from "../publication/WriteOutput";
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
    _identity,
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
    const refKey = (ref: { rootId: string; relativePath: string }) => `${ref.rootId}\0${ref.relativePath}`;
    const sourceKeys = new Set(sources.map(refKey));
    const outputKeys = new Set(outputs.map(refKey));
    const owners = new Set([
      ...(movieId ? [movieId] : []),
      ...snapshot.files.filter((file) => sourceKeys.has(refKey(file))).map((file) => file.itemId),
      ...assets.filter((asset) => outputKeys.has(refKey(asset))).map((asset) => asset.itemId),
    ]);
    if (owners.size > 1) throw new Error("Maintenance files belong to different library movies");
    const resolvedMovieId = [...owners][0] ?? randomUUID();
    const members = sources.map((source) => {
      const registered = snapshot.files.find((file) => refKey(file) === refKey(source));
      return { ...source, fileId: registered?.fileId ?? source.fileId ?? randomUUID() };
    });
    const expected = {
      files: snapshot.files.filter((file) => file.itemId === resolvedMovieId),
      assets: assets.filter((asset) => asset.itemId === resolvedMovieId),
    };
    return {
      movieId: resolvedMovieId,
      files: expected.files.length
        ? expected.files
            .map((file) => {
              if (!file.fileId) throw new Error("Registered maintenance file has no ID");
              return { rootId: file.rootId, relativePath: file.relativePath, fileId: file.fileId };
            })
            .sort((left, right) => left.fileId.localeCompare(right.fileId))
        : members.map(({ rootId, relativePath, fileId }) => ({ rootId, relativePath, fileId })),
      expected,
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
      const output = input.output;
      const files = output.files.map((file) => ({
        fileId: file.fileId,
        rootId: file.target.rootId,
        rootRelativePath: file.target.relativePath,
        size: file.size,
        modifiedAt: file.modifiedAt,
        assets: libraryAssetsFromMovieOutput(output, file.assets),
        lastKnownPath: file.target.relativePath,
      }));
      const crawlerData = input.crawlerData;
      const identity = crawlerData?.number || input.fallbackNumber;
      const movie = {
        id: output.movieId,
        assets: libraryAssetsFromMovieOutput(output, output.movieAssets),
        mediaIdentity: identity,
        number: identity,
        title: crawlerData?.title,
        actors: crawlerData?.actors,
        crawlerDataJson: crawlerData ? JSON.stringify(crawlerData) : undefined,
        lastRefreshedAt: input.refreshedAt,
      };
      const lockKeys = [
        ...output.moves.map((move) => dirname(move.targetPath)),
        ...output.artifacts.map((artifact) => dirname(artifact.targetPath)),
      ];
      const release = mediaPathOwnership.acquireAll(lockKeys, input.ownershipToken);
      let published: PublicationResult<{ libraryItemId: string }>;
      try {
        const commit = () => ({ libraryItemId: state.library.writeEntry(movie, files) });
        published = output.moves.length
          ? await new MoveOutput().install({
              operationId: output.operationId,
              operationType: "maintenance",
              moves: output.moves,
              artifacts: output.artifacts,
              journal: state.publicationJournal,
              protectedSourceRoots: output.protectedSourceRoots,
              commit,
            })
          : await new WriteOutput().install(output.artifacts, {
              protectedSourceRoots: output.protectedSourceRoots,
              commit,
            });
      } finally {
        release();
      }
      return { ...published.value, cleanupIssues: published.cleanupIssues };
    },
  };
};

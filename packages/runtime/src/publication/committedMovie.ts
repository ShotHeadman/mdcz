import type { LibraryRepository } from "@mdcz/persistence";
import type { PreparedMovieOutput } from "./movieArtifacts";
import type { PublicationLibraryAsset } from "./outputLibrary";

export interface CommittedMovieFile {
  readonly fileId: string;
  readonly rootId: string;
  readonly rootRelativePath: string;
  readonly size: number;
  readonly modifiedAtMs: number | null;
  readonly partNumber?: number | null;
  readonly partSuffix?: string | null;
  readonly resolution?: string | null;
  readonly entryIdentity: string;
  readonly sourceEntryIdentity: string;
}

export interface CommittedMovieAsset extends PublicationLibraryAsset {
  readonly fileId: string | null;
}

export interface CommittedMovie {
  readonly id: string;
  readonly mediaIdentity: string;
  readonly title: string;
  readonly number: string;
  readonly actors: readonly string[];
  readonly crawlerDataJson: string;
  readonly sources?: import("@mdcz/shared/types").ScrapeResult["sources"];
  readonly files: readonly CommittedMovieFile[];
  readonly assets: readonly CommittedMovieAsset[];
}

export const toCommittedMovie = (
  output: Pick<PreparedMovieOutput, "movieId" | "files" | "movieAssets" | "publishedTargets">,
  group: NonNullable<PreparedMovieOutput["scrape"]>,
): CommittedMovie => {
  if (!group || !output.files.length) {
    throw new Error("Committed movie requires metadata and files");
  }
  const identity = group.crawlerData.number.trim() || output.files[0].scrape?.identity.fileName;
  if (!identity) throw new Error("Committed movie has no media identity");
  const crawlerDataJson = JSON.stringify(group.crawlerData);

  const refKey = (ref: { rootId: string; relativePath: string }) => `${ref.rootId}\0${ref.relativePath}`;
  const published = new Set(output.publishedTargets.map(refKey));

  const assets: CommittedMovieAsset[] = [
    ...output.movieAssets.map((asset) => ({ asset, fileId: null })),
    ...output.files.flatMap((file) => file.assets.map((asset) => ({ asset, fileId: file.fileId }))),
  ].map(({ asset, fileId }) =>
    Object.freeze(
      asset.type === "remote"
        ? { fileId, kind: asset.kind, uri: asset.url }
        : {
            fileId,
            kind: asset.kind,
            uri: asset.file.relativePath,
            rootId: asset.file.rootId,
            relativePath: asset.file.relativePath,
            ...(published.has(refKey(asset.file)) ? { published: true } : {}),
          },
    ),
  );

  const files: CommittedMovieFile[] = output.files.map((video) => {
    const facts = video.fileInfo;
    return Object.freeze({
      fileId: video.fileId,
      rootId: video.target.rootId,
      rootRelativePath: video.target.relativePath,
      size: video.size,
      modifiedAtMs: video.modifiedAt?.getTime() ?? null,
      partNumber: facts?.part?.number ?? null,
      partSuffix: facts?.part?.suffix ?? null,
      resolution: facts?.resolution ?? null,
      entryIdentity: video.entryIdentity,
      sourceEntryIdentity: video.sourceEntryIdentity,
    });
  });

  return Object.freeze({
    id: output.movieId,
    mediaIdentity: identity,
    number: identity,
    title: group.crawlerData.title,
    actors: Object.freeze([...group.crawlerData.actors]),
    crawlerDataJson,
    sources: group.sources ? Object.freeze({ ...group.sources }) : undefined,
    files: Object.freeze(files),
    assets: Object.freeze(assets),
  });
};

export const committedMovieRows = (movie: CommittedMovie) => ({
  movie: {
    id: movie.id,
    mediaIdentity: movie.mediaIdentity,
    number: movie.number,
    title: movie.title,
    actors: [...movie.actors],
    crawlerDataJson: movie.crawlerDataJson,
    lastRefreshedAt: new Date(),
    assets: movie.assets.filter((asset) => asset.fileId === null),
  },
  files: movie.files.map((file) => ({
    fileId: file.fileId,
    entryIdentity: file.entryIdentity,
    sourceEntryIdentity: file.sourceEntryIdentity,
    rootId: file.rootId,
    rootRelativePath: file.rootRelativePath,
    size: file.size,
    modifiedAt: file.modifiedAtMs === null ? null : new Date(file.modifiedAtMs),
    partNumber: file.partNumber,
    partSuffix: file.partSuffix,
    resolution: file.resolution,
    assets: movie.assets.filter((asset) => asset.fileId === file.fileId),
    lastKnownPath: file.rootRelativePath,
  })),
});

export const writeCommittedMovie = (library: Pick<LibraryRepository, "writeEntry">, movie: CommittedMovie): string => {
  const rows = committedMovieRows(movie);
  return library.writeEntry(rows.movie, rows.files);
};

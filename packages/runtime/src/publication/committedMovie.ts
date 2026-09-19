import type { PublicationLibraryAsset } from "./outputLibrary";
import type { PreparedMovieOutput } from "./prepareMovieOutput";

export interface CommittedMovieFile {
  readonly fileId: string;
  readonly rootId: string;
  readonly rootRelativePath: string;
  readonly size: number;
  readonly modifiedAtMs: number | null;
  readonly partNumber?: number | null;
  readonly partSuffix?: string | null;
  readonly resolution?: string | null;
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
  readonly sourceMap: Readonly<Record<string, string>>;
}

export const toCommittedMovie = (output: PreparedMovieOutput): CommittedMovie => {
  const group = output.scrape;
  if (!group || !output.files.length) {
    throw new Error("Scrape output requires prepared movie facts and files");
  }
  const identity = group.crawlerData.number.trim() || output.files[0].scrape?.identity.fileName;
  if (!identity) throw new Error("Scrape movie has no media identity");
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
    const facts = video.scrape;
    return Object.freeze({
      fileId: video.fileId,
      rootId: video.target.rootId,
      rootRelativePath: video.target.relativePath,
      size: video.size,
      modifiedAtMs: video.modifiedAt?.getTime() ?? null,
      partNumber: facts?.fileInfo.part?.number ?? null,
      partSuffix: facts?.fileInfo.part?.suffix ?? null,
      resolution: facts?.fileInfo.resolution ?? null,
    });
  });

  const sourceMap: Record<string, string> = {};
  for (const video of output.files) {
    if (video.scrape?.itemId) {
      sourceMap[video.scrape.itemId] = video.fileId;
    }
  }

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
    sourceMap: Object.freeze(sourceMap),
  });
};

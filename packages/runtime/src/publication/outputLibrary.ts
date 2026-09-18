import type { AssetRef } from "@mdcz/shared/mediaRef";
import type { PreparedMovieFile, PreparedMovieOutput } from "./prepareMovieOutput";

const refKey = (ref: { rootId: string; relativePath: string }): string => `${ref.rootId}\0${ref.relativePath}`;

export interface PublicationLibraryAsset {
  kind: string;
  uri: string;
  rootId?: string | null;
  relativePath?: string | null;
  published?: boolean;
}

export const libraryAssetsFromMovieOutput = (
  output: PreparedMovieOutput,
  assets: readonly AssetRef[],
): PublicationLibraryAsset[] => {
  const published = new Set([...output.publishedTargets.map(refKey)]);
  return assets.map((asset) => {
    if (asset.type === "remote") return { kind: asset.kind, uri: asset.url };
    return {
      kind: asset.kind,
      uri: asset.file.relativePath,
      rootId: asset.file.rootId,
      relativePath: asset.file.relativePath,
      ...(published.has(refKey(asset.file)) ? { published: true } : {}),
    };
  });
};

export const movieOutputResultAssets = (output: PreparedMovieOutput, media: PreparedMovieFile): AssetRef[] => [
  ...output.movieAssets,
  ...media.assets,
];

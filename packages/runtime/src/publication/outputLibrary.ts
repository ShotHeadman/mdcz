import type { AssetRef } from "@mdcz/shared/mediaRef";
import type { PreparedMovieFile, PreparedMovieOutput } from "./movieArtifacts";

export interface PublicationLibraryAsset {
  kind: string;
  uri: string;
  rootId?: string | null;
  relativePath?: string | null;
  published?: boolean;
}

export const movieOutputResultAssets = (
  output: Pick<PreparedMovieOutput, "movieAssets">,
  media: PreparedMovieFile,
): AssetRef[] => [...output.movieAssets, ...media.assets];

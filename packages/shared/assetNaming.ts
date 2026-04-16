export const ASSET_NAMING_MODES = ["fixed", "followVideo"] as const;
export const MOVIE_NFO_BASE_NAME = "movie";
const TEMPLATE_PLACEHOLDER = /\{([^{}]+)\}/gu;

export type AssetNamingMode = (typeof ASSET_NAMING_MODES)[number];
export type MovieAssetKind = "thumb" | "poster" | "fanart" | "trailer";

export interface MovieAssetFileNames {
  thumb: string;
  poster: string;
  fanart: string;
  trailer: string;
}

const FIXED_MOVIE_ASSET_FILE_NAMES: MovieAssetFileNames = {
  thumb: "thumb.jpg",
  poster: "poster.jpg",
  fanart: "fanart.jpg",
  trailer: "trailer.mp4",
};

export const isSharedDirectoryMode = (input: { successFileMove: boolean; folderTemplate: string }): boolean => {
  if (!input.successFileMove) {
    return false;
  }

  for (const match of input.folderTemplate.matchAll(TEMPLATE_PLACEHOLDER)) {
    const key = match[1]?.trim().toLowerCase();
    if (key === "number" || key === "title" || key === "originaltitle") {
      return false;
    }
  }

  return true;
};

export const isMovieNfoBaseName = (value: string): boolean => value.trim().toLowerCase() === MOVIE_NFO_BASE_NAME;

export const buildMovieAssetFileNames = (
  movieBaseName: string,
  assetNamingMode: AssetNamingMode = "fixed",
): MovieAssetFileNames => {
  const trimmedBaseName = movieBaseName.trim();
  if (assetNamingMode !== "followVideo" || trimmedBaseName.length === 0) {
    return { ...FIXED_MOVIE_ASSET_FILE_NAMES };
  }

  return {
    thumb: `${trimmedBaseName}-thumb.jpg`,
    poster: `${trimmedBaseName}-poster.jpg`,
    fanart: `${trimmedBaseName}-fanart.jpg`,
    trailer: `${trimmedBaseName}-trailer.mp4`,
  };
};

export const getMovieAssetFileName = (
  kind: MovieAssetKind,
  movieBaseName: string,
  assetNamingMode: AssetNamingMode = "fixed",
): string => {
  return buildMovieAssetFileNames(movieBaseName, assetNamingMode)[kind];
};

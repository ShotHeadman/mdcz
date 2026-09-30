import path from "node:path";
import { MOVIE_NFO_BASE_NAME } from "@mdcz/shared/assetNaming";

export const preferredLocalNfoBaseNames = (
  fileName: string,
  partSuffix: string | undefined,
  singleMovieDirectory: boolean,
): string[] => [
  ...(partSuffix && fileName.endsWith(partSuffix) ? [fileName.slice(0, -partSuffix.length)] : []),
  fileName,
  ...(singleMovieDirectory ? [MOVIE_NFO_BASE_NAME] : []),
];

/** Every NFO name that belongs to the video, most preferred first. */
export const selectLocalNfoNames = (
  nfoNames: readonly string[],
  preferredBaseNames: readonly string[],
  singleMovieDirectory: boolean,
): string[] => {
  const matches = preferredBaseNames.flatMap((baseName) =>
    nfoNames.filter((name) => path.parse(name).name.toLowerCase() === baseName.toLowerCase()),
  );
  if (matches.length) return [...new Set(matches)];
  return singleMovieDirectory && nfoNames.length === 1 ? [...nfoNames] : [];
};

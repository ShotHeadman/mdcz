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

export const selectLocalNfoName = (
  nfoNames: readonly string[],
  preferredBaseNames: readonly string[],
  singleMovieDirectory: boolean,
): string | undefined => {
  for (const baseName of preferredBaseNames) {
    const match = nfoNames.find((name) => path.parse(name).name.toLowerCase() === baseName.toLowerCase());
    if (match) return match;
  }
  return singleMovieDirectory && nfoNames.length === 1 ? nfoNames[0] : undefined;
};

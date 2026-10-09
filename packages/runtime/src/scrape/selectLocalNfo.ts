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

/**
 * The NFOs that exist, the one saved last first: with `<video>.nfo` and `movie.nfo` side by side, whichever media
 * server a person edited in wins. Ties keep the given order. Missing files (stale registrations) are dropped.
 */
export const newestNfosFirst = async (
  nfoPaths: readonly string[],
  stats: (nfoPath: string) => Promise<{ mtimeMs: number }>,
): Promise<string[]> => {
  const existing: Array<{ nfoPath: string; mtimeMs: number }> = [];
  for (const nfoPath of nfoPaths) {
    try {
      existing.push({ nfoPath, mtimeMs: (await stats(nfoPath)).mtimeMs });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return existing.sort((left, right) => right.mtimeMs - left.mtimeMs).map(({ nfoPath }) => nfoPath);
};

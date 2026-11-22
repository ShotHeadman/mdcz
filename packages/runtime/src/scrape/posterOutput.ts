import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { type AssetNamingMode, buildMovieAssetFileNames } from "@mdcz/shared/assetNaming";
import type { PosterRecord } from "@mdcz/shared/types";
import { type MovieLibrary, writePublishedMovie } from "../library/registeredMedia";
import { acquireOutputDirectories } from "../publication/outputMutex";
import { toRootFileRef } from "../publication/outputRefs";
import { WriteOutput } from "../publication/WriteOutput";
import type { RuntimeLogger } from "../shared";
import { DirectoryInventory } from "./DirectoryInventory";
import type { NfoGenerator } from "./nfo";

const THUMB_NAME = /thumb(?=\.[^.]+$)/u;

/** Where a movie's poster goes: its current file, or beside its cover under the matching name. */
export const posterTargetPath = (
  videoPath: string,
  assetNamingMode: AssetNamingMode,
  assets: { thumb?: string; poster?: string },
): string => {
  if (assets.poster) return assets.poster;
  const names = buildMovieAssetFileNames(basename(videoPath, extname(videoPath)), assetNamingMode);
  if (!assets.thumb) return join(dirname(videoPath), names.poster);
  const thumbName = basename(assets.thumb);
  return join(
    dirname(assets.thumb),
    THUMB_NAME.test(thumbName) ? thumbName.replace(THUMB_NAME, "poster") : names.poster,
  );
};

/**
 * Installs a poster made outside a scrape, with its record in every NFO copy a media server may read, as one write the
 * library commits. Without a record the NFOs stay as they are.
 */
export const installPoster = async (input: {
  posterPath: string;
  stagedPoster: string;
  record?: {
    value: PosterRecord;
    nfoPaths: readonly string[];
    nfoGenerator: Pick<NfoGenerator, "mergePosterRecordXml">;
  };
  protectedMediaFiles: readonly string[];
  movie?: { library: MovieLibrary; movieId: string; roots: readonly { id: string; hostPath: string }[] };
  logger?: Pick<RuntimeLogger, "warn">;
}): Promise<void> => {
  const { record, movie } = input;
  const nfoPaths = record?.nfoPaths ?? [];
  const inventory = new DirectoryInventory();
  const release = await acquireOutputDirectories([input.posterPath, ...nfoPaths], (directory) =>
    inventory.canonicalDirectory(directory),
  );
  try {
    const nfoArtifacts = record
      ? await Promise.all(
          record.nfoPaths.map(async (targetPath) => ({
            targetPath,
            data: record.nfoGenerator.mergePosterRecordXml(await readFile(targetPath, "utf8"), record.value),
          })),
        )
      : [];
    await new WriteOutput(undefined, input.logger).install(
      [
        {
          targetPath: input.posterPath,
          sourcePath: input.stagedPoster,
          size: (await stat(input.stagedPoster)).size,
          consume: true,
        },
        ...nfoArtifacts,
      ],
      {
        protectedMediaFiles: input.protectedMediaFiles,
        commit: async () => {
          if (!movie) return;
          await writePublishedMovie(
            movie.library,
            movie.movieId,
            [
              { kind: "poster" as const, path: input.posterPath },
              ...nfoPaths.map((path) => ({ kind: "nfo" as const, path })),
            ].map(({ kind, path }) => {
              const ref = toRootFileRef(path, movie.roots);
              return {
                kind,
                uri: ref.relativePath,
                rootId: ref.rootId,
                relativePath: ref.relativePath,
                published: true,
              };
            }),
          );
        },
      },
    );
  } finally {
    release();
  }
};

import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { MediaRoot } from "@mdcz/media-store";
import { type AssetNamingMode, buildMovieAssetFileNames } from "@mdcz/shared/assetNaming";
import type { Configuration } from "@mdcz/shared/config";
import type { NormalizedCropRegion } from "@mdcz/shared/posterCrop";
import type { LocalScanEntry, PosterCut, PosterRecord } from "@mdcz/shared/types";
import { type MovieLibrary, resolveRegisteredNfoPaths, writePublishedMovie } from "../library/registeredMedia";
import { acquireOutputDirectories } from "../publication/outputMutex";
import { toRootFileRef } from "../publication/outputRefs";
import { createStagingDirectory, removeStagingDirectory } from "../publication/publicationJournal";
import type { PublicationOutputPort } from "../publication/types";
import { WriteOutput } from "../publication/WriteOutput";
import type { RuntimeLogger } from "../shared";
import { DirectoryInventory } from "./DirectoryInventory";
import type { DownloadManager } from "./download/DownloadManager";
import type { NfoGenerator } from "./nfo";
import { applyPosterTagBadgesIfNeeded } from "./output/applyPosterTagBadges";
import { cutPoster } from "./posterCut";

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

export interface PosterInstallContext {
  config: Configuration;
  dataDir: string;
  downloadManager: Pick<DownloadManager, "downloadPlainPoster">;
  nfoGenerator: Pick<NfoGenerator, "mergePosterRecordXml">;
  publication: {
    roots: readonly Pick<MediaRoot, "id" | "hostPath">[];
    /** Absent outside the library, where no NFO copy or asset row is registered. */
    library?: MovieLibrary & PublicationOutputPort;
    /** The library movie the poster belongs to, known up front when it may have no registered NFO. */
    movieId?: string;
  };
  logger: Pick<RuntimeLogger, "warn">;
}

/**
 * Installs a poster made outside a scrape as one write the library commits. A cut from a source a record can name is
 * badged like a maintenance rebuild and recorded in every NFO copy a media server may read, so later rebuilds repeat
 * it; a cut of a local file no rebuild could repeat leaves the NFOs as they are.
 */
export const installPoster = async (
  entry: LocalScanEntry,
  posterPath: string,
  cut: PosterCut | { file: string; crop: NormalizedCropRegion },
  context: PosterInstallContext,
): Promise<void> => {
  const { nfoPath, crawlerData } = entry;
  const { library, roots } = context.publication;
  const stagingDir = await createStagingDirectory(dirname(posterPath));
  try {
    const stagedPoster = join(stagingDir, basename(posterPath));
    let record: PosterRecord | undefined;
    if ("file" in cut) {
      if (!(await cutPoster(cut.file, cut.crop, stagedPoster)))
        throw new Error("Poster crop must use a 2:3 aspect ratio");
    } else {
      if (!nfoPath || !crawlerData) throw new Error("Cutting from a recorded source requires the movie's NFO");
      const plain = await context.downloadManager.downloadPlainPoster({
        data: crawlerData,
        cut,
        targetPath: stagedPoster,
        thumbPath: entry.assets.thumb,
      });
      if (!plain) throw new Error(`Could not cut a poster from ${cut.source}`);
      const { posterRecord } = await applyPosterTagBadgesIfNeeded({
        assets: { poster: plain, sceneImages: [], downloaded: [plain] },
        config: context.config,
        crawlerData,
        dataDir: context.dataDir,
        fileInfo: entry.fileInfo,
        localState: entry.nfoLocalState,
        logger: context.logger,
      });
      if (!posterRecord) throw new Error("Badge drawing returned no poster record");
      record = { ...posterRecord, cut };
    }
    const registered = library && nfoPath ? await resolveRegisteredNfoPaths(nfoPath, library, roots) : undefined;
    const movieId = registered?.movieId ?? context.publication.movieId;
    const nfoPaths = record ? (registered?.paths ?? entry.nfoPaths) : [];
    const inventory = new DirectoryInventory();
    const release = await acquireOutputDirectories([posterPath, ...nfoPaths], (directory) =>
      inventory.canonicalDirectory(directory),
    );
    try {
      const nfoArtifacts = record
        ? await Promise.all(
            nfoPaths.map(async (targetPath) => ({
              targetPath,
              data: context.nfoGenerator.mergePosterRecordXml(await readFile(targetPath, "utf8"), record),
            })),
          )
        : [];
      await new WriteOutput(undefined, context.logger).install(
        [
          { targetPath: posterPath, sourcePath: stagedPoster, size: (await stat(stagedPoster)).size, consume: true },
          ...nfoArtifacts,
        ],
        {
          protectedMediaFiles: registered?.mediaPaths ?? [entry.fileInfo.filePath],
          commit: async () => {
            if (!library || !movieId) return;
            await writePublishedMovie(
              library,
              movieId,
              [
                { kind: "poster" as const, path: posterPath },
                ...nfoPaths.map((path) => ({ kind: "nfo" as const, path })),
              ].map(({ kind, path }) => {
                const ref = toRootFileRef(path, roots);
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
  } finally {
    await removeStagingDirectory(stagingDir);
  }
};

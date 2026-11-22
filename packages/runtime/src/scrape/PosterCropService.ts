import { basename, dirname, join } from "node:path";
import type { AssetNamingMode } from "@mdcz/shared/assetNaming";
import type { Configuration } from "@mdcz/shared/config";
import { isPosterShaped, type NormalizedCropRegion, resolvePosterEditorCropRegion } from "@mdcz/shared/posterCrop";
import type { LocalScanEntry, PosterRecord } from "@mdcz/shared/types";
import sharp from "sharp";
import { type MovieLibrary, resolveRegisteredNfoPaths } from "../library/registeredMedia";
import { createStagingDirectory, removeStagingDirectory } from "../publication/publicationJournal";
import type { PublicationOutputPort } from "../publication/types";
import type { RuntimeLogger } from "../shared";
import type { DownloadManager } from "./download/DownloadManager";
import type { NfoGenerator } from "./nfo";
import { applyPosterTagBadgesIfNeeded } from "./output/applyPosterTagBadges";
import { cutPoster } from "./posterCut";
import { installPoster, posterTargetPath } from "./posterOutput";

export interface PosterCropSession {
  /** A local file, or a remote image the browser loads directly. */
  source: { path: string } | { url: string };
  targetPath: string;
  width: number;
  height: number;
  initialCrop: NormalizedCropRegion;
}

/** `cut` is what the poster record names, so a rebuild repeats the cut; the poster file itself names nothing. */
type CropImage =
  | { cut: string; image: { url: string } | { path: string } }
  | { cut?: undefined; image: { path: string } };
type CropSource = CropImage & { width: number; height: number };

export class PosterCropService {
  constructor(private readonly downloadManager: Pick<DownloadManager, "probeImageSize" | "downloadPlainPoster">) {}

  /** Null when the movie has nothing to cut a poster from. */
  async prepare(entry: LocalScanEntry, assetNamingMode: AssetNamingMode): Promise<PosterCropSession | null> {
    const source = await this.openSource(entry);
    if (!source) return null;
    const recorded = entry.nfoLocalState?.posterRecord?.cut;
    return {
      source: source.image,
      targetPath: posterTargetPath(entry.fileInfo.filePath, assetNamingMode, entry.assets),
      width: source.width,
      height: source.height,
      initialCrop:
        recorded && recorded.source === source.cut && isPosterShaped(recorded.crop, source.width, source.height)
          ? recorded.crop
          : resolvePosterEditorCropRegion(source.width, source.height),
    };
  }

  /** Cuts and badges the poster like a maintenance rebuild, and records how in the NFO so later rebuilds repeat it. */
  async save(
    entry: LocalScanEntry,
    assetNamingMode: AssetNamingMode,
    crop: NormalizedCropRegion,
    output: {
      config: Configuration;
      dataDir: string;
      nfoGenerator: Pick<NfoGenerator, "mergePosterRecordXml">;
      movie?: {
        library: MovieLibrary & PublicationOutputPort;
        movieId: string;
        roots: readonly { id: string; hostPath: string }[];
      };
      logger: Pick<RuntimeLogger, "warn">;
    },
  ): Promise<PosterCropSession> {
    const source = await this.openSource(entry);
    if (!source) throw new Error("No cover or poster is available for editing");
    const targetPath = posterTargetPath(entry.fileInfo.filePath, assetNamingMode, entry.assets);
    const { nfoPath, crawlerData } = entry;
    const stagingDir = await createStagingDirectory(dirname(targetPath));
    try {
      const stagedPoster = join(stagingDir, basename(targetPath));
      let record: PosterRecord | undefined;
      if (source.cut === undefined) {
        if (!(await cutPoster(source.image.path, crop, stagedPoster)))
          throw new Error("Poster crop must use a 2:3 aspect ratio");
      } else {
        // Only a movie with an NFO offers a source a record can name.
        if (!nfoPath || !crawlerData) throw new Error("Cutting from a recorded source requires the movie's NFO");
        const cut = { source: source.cut, crop };
        const plain = await this.downloadManager.downloadPlainPoster({
          data: crawlerData,
          cut,
          targetPath: stagedPoster,
          thumbPath: entry.assets.thumb,
        });
        if (!plain)
          throw new Error(`Could not cut a poster from ${"url" in source.image ? source.image.url : "the cover"}`);
        const { posterRecord } = await applyPosterTagBadgesIfNeeded({
          assets: { poster: plain, sceneImages: [], downloaded: [plain] },
          config: output.config,
          crawlerData,
          dataDir: output.dataDir,
          fileInfo: entry.fileInfo,
          localState: entry.nfoLocalState,
          logger: output.logger,
        });
        if (!posterRecord) throw new Error("Badge drawing returned no poster record");
        record = { ...posterRecord, cut };
      }
      const { movie } = output;
      const registered =
        record && nfoPath && movie
          ? await resolveRegisteredNfoPaths(nfoPath, movie.library, async (id) => {
              const root = movie.roots.find((root) => root.id === id);
              if (!root) throw new Error(`Publication root not found: ${id}`);
              return root;
            })
          : undefined;
      await installPoster({
        posterPath: targetPath,
        stagedPoster,
        record: record && {
          value: record,
          nfoPaths: registered?.paths ?? entry.nfoPaths,
          nfoGenerator: output.nfoGenerator,
        },
        protectedMediaFiles: registered?.mediaPaths ?? [entry.fileInfo.filePath],
        movie,
        logger: output.logger,
      });
    } finally {
      await removeStagingDirectory(stagingDir);
    }
    return { source: source.image, targetPath, width: source.width, height: source.height, initialCrop: crop };
  }

  /**
   * The poster's own source when its record names an image that can still be read, then the cover, local before
   * remote. Without a cover the poster file itself is cut, which no rebuild could repeat.
   */
  private async openSource(entry: LocalScanEntry): Promise<CropSource | undefined> {
    const recordable = Boolean(entry.nfoPath && entry.crawlerData);
    const recorded = entry.nfoLocalState?.posterRecord?.cut;
    const remoteCover = entry.crawlerData?.thumb_source_url;
    const candidates: CropImage[] = [
      ...(recordable && recorded && recorded.source !== "cover"
        ? [{ cut: recorded.source, image: { url: recorded.source } }]
        : []),
      ...(entry.assets.thumb
        ? [recordable ? { cut: "cover", image: { path: entry.assets.thumb } } : { image: { path: entry.assets.thumb } }]
        : []),
      ...(recordable && remoteCover ? [{ cut: "cover", image: { url: remoteCover } }] : []),
      ...(entry.assets.poster ? [{ image: { path: entry.assets.poster } }] : []),
    ];
    for (const candidate of candidates) {
      const size =
        "url" in candidate.image
          ? await this.downloadManager.probeImageSize(candidate.image.url)
          : await sharp(candidate.image.path, { animated: false }).metadata();
      if (size?.width && size.height) return { ...candidate, width: size.width, height: size.height };
    }
    return undefined;
  }
}

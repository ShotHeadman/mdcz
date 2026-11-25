import type { AssetNamingMode } from "@mdcz/shared/assetNaming";
import { type NormalizedCropRegion, resolveInitialPosterCrop } from "@mdcz/shared/posterCrop";
import type { LocalScanEntry } from "@mdcz/shared/types";
import sharp from "sharp";
import type { DownloadManager } from "./download/DownloadManager";
import { installPoster, type PosterInstallContext, posterTargetPath } from "./posterOutput";

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
    return {
      source: source.image,
      targetPath: posterTargetPath(entry.fileInfo.filePath, assetNamingMode, entry.assets),
      width: source.width,
      height: source.height,
      initialCrop: resolveInitialPosterCrop(
        entry.nfoLocalState?.posterRecord?.cut,
        source.cut,
        source.width,
        source.height,
      ),
    };
  }

  /** Cuts and badges the poster like a maintenance rebuild, and records how in the NFO so later rebuilds repeat it. */
  async save(
    entry: LocalScanEntry,
    assetNamingMode: AssetNamingMode,
    crop: NormalizedCropRegion,
    context: Omit<PosterInstallContext, "downloadManager">,
  ): Promise<PosterCropSession> {
    const source = await this.openSource(entry);
    if (!source) throw new Error("No cover or poster is available for editing");
    const targetPath = posterTargetPath(entry.fileInfo.filePath, assetNamingMode, entry.assets);
    await installPoster(
      entry,
      targetPath,
      source.cut === undefined ? { file: source.image.path, crop } : { source: source.cut, crop },
      { ...context, downloadManager: this.downloadManager },
    );
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

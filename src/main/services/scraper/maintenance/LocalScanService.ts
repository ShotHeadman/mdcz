import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, parse } from "node:path";
import { loggerService } from "@main/services/LoggerService";
import { listVideoFiles } from "@main/utils/file";
import { parseNfoSnapshot } from "@main/utils/nfo";
import { buildFileId } from "@shared/mediaIdentity";
import type { CrawlerData, DiscoveredAssets, LocalScanEntry } from "@shared/types";
import { isGeneratedSidecarVideo, resolveFileInfoWithSubtitles } from "../media";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const TRAILER_EXTENSIONS = new Set([".mp4", ".mkv", ".webm"]);

const fileExists = async (path: string): Promise<boolean> => {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
};

const dirExists = async (path: string): Promise<boolean> => {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
};

/** Find an asset file by base name (without extension) in the given directory. */
const findAssetByName = async (dir: string, baseName: string, extensions: Set<string>): Promise<string | undefined> => {
  for (const ext of extensions) {
    const candidate = join(dir, `${baseName}${ext}`);
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
  return undefined;
};

/** List files in a subdirectory matching the given extensions. */
const listSubdirFiles = async (parentDir: string, subDirName: string, extensions: Set<string>): Promise<string[]> => {
  const subDir = join(parentDir, subDirName);
  if (!(await dirExists(subDir))) {
    return [];
  }
  try {
    const entries = await readdir(subDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && extensions.has(extname(e.name).toLowerCase()))
      .map((e) => join(subDir, e.name));
  } catch {
    return [];
  }
};

export class LocalScanService {
  private readonly logger = loggerService.getLogger("LocalScanService");

  /**
   * Scan a directory for video files and discover their local NFO and assets.
   * This is a pure read-only operation — no files are modified.
   */
  async scan(dirPath: string, sceneImagesFolder: string): Promise<LocalScanEntry[]> {
    this.logger.info(`Scanning directory: ${dirPath}`);

    const videoFiles = (await listVideoFiles(dirPath, true)).filter((videoPath) => !isGeneratedSidecarVideo(videoPath));
    this.logger.info(`Found ${videoFiles.length} video file(s)`);

    const entries: LocalScanEntry[] = [];

    for (const videoPath of videoFiles) {
      try {
        const entry = await this.scanVideo(videoPath, sceneImagesFolder);
        entries.push(entry);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to scan ${videoPath}: ${message}`);
      }
    }

    this.logger.info(`Scan complete: ${entries.length} entries`);
    return entries;
  }

  /** Scan a single video file and discover its NFO and assets. */
  async scanVideo(videoPath: string, sceneImagesFolder: string): Promise<LocalScanEntry> {
    const { fileInfo } = await resolveFileInfoWithSubtitles(videoPath);
    const dir = dirname(videoPath);

    const [assets, nfoPath] = await Promise.all([
      this.discoverAssets(dir, sceneImagesFolder),
      this.findNfo(dir, fileInfo),
    ]);
    let crawlerData: CrawlerData | undefined;
    let nfoLocalState: LocalScanEntry["nfoLocalState"];
    let scanError: string | undefined;

    if (nfoPath) {
      try {
        const nfoContent = await readFile(nfoPath, "utf-8");
        const snapshot = parseNfoSnapshot(nfoContent);
        crawlerData = snapshot.crawlerData;
        nfoLocalState = snapshot.localState;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        scanError = `NFO 解析失败: ${message}`;
        this.logger.warn(`Failed to parse NFO at ${nfoPath}: ${message}`);
      }
    }

    return {
      fileId: buildFileId(videoPath),
      fileInfo,
      nfoPath,
      crawlerData,
      nfoLocalState,
      scanError,
      assets,
      currentDir: dir,
      groupingDirectory: dir,
    };
  }

  /** Discover assets (NFO, images, trailer, actor photos) in a video directory. */
  private async discoverAssets(dir: string, sceneImagesFolder: string): Promise<DiscoveredAssets> {
    const [thumb, poster, fanart, trailer, sceneImages, actorPhotos] = await Promise.all([
      findAssetByName(dir, "thumb", IMAGE_EXTENSIONS),
      findAssetByName(dir, "poster", IMAGE_EXTENSIONS),
      findAssetByName(dir, "fanart", IMAGE_EXTENSIONS),
      findAssetByName(dir, "trailer", TRAILER_EXTENSIONS),
      listSubdirFiles(dir, sceneImagesFolder, IMAGE_EXTENSIONS),
      listSubdirFiles(dir, ".actors", IMAGE_EXTENSIONS),
    ]);

    return {
      thumb,
      poster,
      fanart,
      sceneImages,
      trailer,
      actorPhotos,
    };
  }

  /** Find the NFO file in a directory, preferring one that matches the video filename. */
  private async findNfo(dir: string, fileInfo: LocalScanEntry["fileInfo"]): Promise<string | undefined> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const nfoEntries = entries.filter((e) => e.isFile() && extname(e.name).toLowerCase() === ".nfo");

      if (nfoEntries.length === 0) return undefined;

      // Prefer NFO whose base name matches the video file
      const videoBaseName = parse(fileInfo.fileName).name.toLowerCase();
      const partlessBaseName =
        fileInfo.part && fileInfo.fileName.endsWith(fileInfo.part.suffix)
          ? fileInfo.fileName.slice(0, -fileInfo.part.suffix.length).toLowerCase()
          : undefined;
      const preferredBaseNames = [partlessBaseName, videoBaseName, "movie"].filter((value): value is string =>
        Boolean(value),
      );
      const match = preferredBaseNames
        .map((baseName) => nfoEntries.find((e) => parse(e.name).name.toLowerCase() === baseName))
        .find(Boolean);

      return join(dir, (match ?? nfoEntries[0]).name);
    } catch {
      return undefined;
    }
  }
}

import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, parse } from "node:path";
import { buildMovieAssetFileNames, isMovieNfoBaseName, MOVIE_NFO_BASE_NAME } from "@mdcz/shared/assetNaming";
import { toErrorMessage } from "@mdcz/shared/error";
import { buildFileId } from "@mdcz/shared/mediaIdentity";
import type { CrawlerData, DiscoveredAssets, LocalScanEntry } from "@mdcz/shared/types";
import { isGeneratedSidecarVideo, resolveFileInfoWithSubtitles } from "../scrape";
import { throwIfAborted } from "../scrape/utils/abort";
import { DEFAULT_VIDEO_EXTENSIONS, listVideoFiles } from "../scrape/utils/filesystem";
import { parseFileInfo } from "../scrape/utils/number";
import { runtimeLoggerService } from "../shared";
import { resolveLocalAssetReference, uniqueDefinedPaths } from "./localAssetReferences";
import { parseNfoSnapshot } from "./nfoSnapshot";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

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

const buildMovieBaseNameCandidates = (input: {
  fileName: string;
  part?: { suffix: string };
  nfoPath?: string;
}): string[] => {
  const outputs: string[] = [];
  const seen = new Set<string>();
  const push = (value: string | undefined) => {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }

    seen.add(trimmed);
    outputs.push(trimmed);
  };

  const nfoBaseName = input.nfoPath ? parse(input.nfoPath).name : undefined;
  if (nfoBaseName && !isMovieNfoBaseName(nfoBaseName)) {
    push(nfoBaseName);
  }

  if (input.part?.suffix && input.fileName.endsWith(input.part.suffix)) {
    push(input.fileName.slice(0, -input.part.suffix.length));
  }

  push(input.fileName);
  return outputs;
};

const buildFollowVideoAssetCandidates = (
  dir: string,
  movieBaseNames: string[],
): Record<"thumb" | "poster" | "fanart" | "trailer", string[]> => {
  const outputs = {
    thumb: [] as string[],
    poster: [] as string[],
    fanart: [] as string[],
    trailer: [] as string[],
  };

  for (const movieBaseName of movieBaseNames) {
    const fileNames = buildMovieAssetFileNames(movieBaseName, "followVideo");
    outputs.thumb.push(join(dir, fileNames.thumb));
    outputs.poster.push(join(dir, fileNames.poster));
    outputs.fanart.push(join(dir, fileNames.fanart));
    outputs.trailer.push(join(dir, fileNames.trailer));
  }

  return outputs;
};

const findFirstExistingPath = async (paths: string[]): Promise<string | undefined> => {
  for (const path of paths) {
    if (await fileExists(path)) {
      return path;
    }
  }

  return undefined;
};

const listExistingPaths = async (paths: string[]): Promise<string[]> => {
  const outputs: string[] = [];
  for (const path of paths) {
    if (await fileExists(path)) {
      outputs.push(path);
    }
  }

  return outputs;
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
      .filter((entry) => entry.isFile() && extensions.has(extname(entry.name).toLowerCase()))
      .map((entry) => join(subDir, entry.name));
  } catch {
    return [];
  }
};

export class LocalScanService {
  private readonly logger = runtimeLoggerService.getLogger("LocalScanService");

  /**
   * Scan a directory for video files and discover their local NFO and assets.
   * This is a pure read-only operation — no files are modified.
   */
  async scan(dirPath: string, sceneImagesFolder: string, signal?: AbortSignal): Promise<LocalScanEntry[]> {
    throwIfAborted(signal);
    this.logger.info(`Scanning directory: ${dirPath}`);

    const videoFiles = (await listVideoFiles(dirPath, true, undefined, signal)).filter(
      (videoPath) => !isGeneratedSidecarVideo(videoPath),
    );
    this.logger.info(`Found ${videoFiles.length} video file(s)`);

    const entries: LocalScanEntry[] = [];

    for (const videoPath of videoFiles) {
      throwIfAborted(signal);
      try {
        const entry = await this.scanVideo(videoPath, sceneImagesFolder, signal);
        entries.push(entry);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw error;
        }
        const message = toErrorMessage(error);
        this.logger.warn(`Failed to scan ${videoPath}: ${message}`);
      }
    }

    this.logger.info(`Scan complete: ${entries.length} entries`);
    return entries;
  }

  async scanFiles(filePaths: string[], sceneImagesFolder: string, signal?: AbortSignal): Promise<LocalScanEntry[]> {
    throwIfAborted(signal);
    const uniqueFilePaths = [...new Set(filePaths.map((filePath) => filePath.trim()).filter(Boolean))];
    const entries: LocalScanEntry[] = [];

    for (const videoPath of uniqueFilePaths) {
      throwIfAborted(signal);
      if (!DEFAULT_VIDEO_EXTENSIONS.has(extname(videoPath).toLowerCase())) {
        continue;
      }

      if (isGeneratedSidecarVideo(videoPath)) {
        continue;
      }

      try {
        const fileStats = await stat(videoPath);
        if (!fileStats.isFile()) {
          continue;
        }

        const entry = await this.scanVideo(videoPath, sceneImagesFolder, signal);
        entries.push(entry);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw error;
        }
        const message = toErrorMessage(error);
        this.logger.warn(`Failed to scan selected file ${videoPath}: ${message}`);
      }
    }

    this.logger.info(`Selected-file scan complete: ${entries.length} entries`);
    return entries;
  }

  /** Scan a single video file and discover its NFO and assets. */
  async scanVideo(videoPath: string, sceneImagesFolder: string, signal?: AbortSignal): Promise<LocalScanEntry> {
    throwIfAborted(signal);
    const { fileInfo } = await resolveFileInfoWithSubtitles(videoPath);
    const dir = dirname(videoPath);

    const nfoPath = await this.findNfo(dir, fileInfo, signal);
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
        const message = toErrorMessage(error);
        scanError = `NFO 解析失败: ${message}`;
        this.logger.warn(`Failed to parse NFO at ${nfoPath}: ${message}`);
      }
    }

    const assets = await this.discoverAssets({
      dir,
      fileInfo,
      nfoPath,
      crawlerData,
      sceneImagesFolder,
      signal,
    });

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
  private async discoverAssets(input: {
    dir: string;
    fileInfo: LocalScanEntry["fileInfo"];
    nfoPath?: string;
    crawlerData?: CrawlerData;
    sceneImagesFolder: string;
    signal?: AbortSignal;
  }): Promise<DiscoveredAssets> {
    throwIfAborted(input.signal);

    const allowDirectoryWideAssets = await this.isSingleMovieDirectory(input.dir, input.signal);
    const movieBaseNames = buildMovieBaseNameCandidates({
      fileName: input.fileInfo.fileName,
      part: input.fileInfo.part,
      nfoPath: input.nfoPath,
    });
    const followVideoAssetCandidates = buildFollowVideoAssetCandidates(input.dir, movieBaseNames);
    const fixedAssetNames = buildMovieAssetFileNames("", "fixed");

    const [thumb, poster, fanart, trailer, sceneImages, actorPhotos] = await Promise.all([
      findFirstExistingPath(
        uniqueDefinedPaths([
          resolveLocalAssetReference(input.dir, input.crawlerData?.thumb_url),
          ...followVideoAssetCandidates.thumb,
          ...(allowDirectoryWideAssets ? [join(input.dir, fixedAssetNames.thumb)] : []),
        ]),
      ),
      findFirstExistingPath(
        uniqueDefinedPaths([
          resolveLocalAssetReference(input.dir, input.crawlerData?.poster_url),
          ...followVideoAssetCandidates.poster,
          ...(allowDirectoryWideAssets ? [join(input.dir, fixedAssetNames.poster)] : []),
        ]),
      ),
      findFirstExistingPath(
        uniqueDefinedPaths([
          resolveLocalAssetReference(input.dir, input.crawlerData?.fanart_url),
          ...followVideoAssetCandidates.fanart,
          ...(allowDirectoryWideAssets ? [join(input.dir, fixedAssetNames.fanart)] : []),
        ]),
      ),
      findFirstExistingPath(
        uniqueDefinedPaths([
          resolveLocalAssetReference(input.dir, input.crawlerData?.trailer_url),
          ...followVideoAssetCandidates.trailer,
          ...(allowDirectoryWideAssets ? [join(input.dir, fixedAssetNames.trailer)] : []),
        ]),
      ),
      this.resolveSceneImages(input.dir, input.sceneImagesFolder, input.crawlerData, allowDirectoryWideAssets),
      this.resolveActorPhotos(input.dir, input.crawlerData),
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

  private async isSingleMovieDirectory(dir: string, signal?: AbortSignal): Promise<boolean> {
    try {
      const videoFiles = (await listVideoFiles(dir, false, undefined, signal)).filter(
        (videoPath) => !isGeneratedSidecarVideo(videoPath),
      );
      const movieNumbers = new Set(videoFiles.map((videoPath) => parseFileInfo(videoPath).number.toUpperCase()));
      return movieNumbers.size <= 1;
    } catch {
      return false;
    }
  }

  private async resolveSceneImages(
    dir: string,
    sceneImagesFolder: string,
    crawlerData: CrawlerData | undefined,
    allowDirectoryWideAssets: boolean,
  ): Promise<string[]> {
    const explicitSceneImages = await listExistingPaths(
      uniqueDefinedPaths((crawlerData?.scene_images ?? []).map((value) => resolveLocalAssetReference(dir, value))),
    );
    if (explicitSceneImages.length > 0) {
      return explicitSceneImages;
    }

    return allowDirectoryWideAssets ? await listSubdirFiles(dir, sceneImagesFolder, IMAGE_EXTENSIONS) : [];
  }

  private async resolveActorPhotos(dir: string, crawlerData: CrawlerData | undefined): Promise<string[]> {
    const explicitActorPhotos = await listExistingPaths(
      uniqueDefinedPaths(
        (crawlerData?.actor_profiles ?? []).map((profile) => resolveLocalAssetReference(dir, profile.photo_url)),
      ),
    );
    if (explicitActorPhotos.length > 0) {
      return explicitActorPhotos;
    }

    return await listSubdirFiles(dir, ".actors", IMAGE_EXTENSIONS);
  }

  /** Find the NFO file in a directory, preferring one that matches the video filename. */
  private async findNfo(
    dir: string,
    fileInfo: LocalScanEntry["fileInfo"],
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    try {
      throwIfAborted(signal);
      const entries = await readdir(dir, { withFileTypes: true });
      const nfoEntries = entries.filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".nfo");

      if (nfoEntries.length === 0) {
        return undefined;
      }

      const videoBaseName = parse(fileInfo.fileName).name.toLowerCase();
      const partlessBaseName =
        fileInfo.part && fileInfo.fileName.endsWith(fileInfo.part.suffix)
          ? fileInfo.fileName.slice(0, -fileInfo.part.suffix.length).toLowerCase()
          : undefined;
      const preferredBaseNames = [partlessBaseName, videoBaseName, MOVIE_NFO_BASE_NAME].filter(
        (value): value is string => Boolean(value),
      );
      const match = preferredBaseNames
        .map((baseName) => nfoEntries.find((entry) => parse(entry.name).name.toLowerCase() === baseName))
        .find(Boolean);

      return join(dir, (match ?? nfoEntries[0]).name);
    } catch {
      return undefined;
    }
  }
}

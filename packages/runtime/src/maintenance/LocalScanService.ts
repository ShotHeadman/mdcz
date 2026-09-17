import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, parse, relative, resolve } from "node:path";
import { deterministicMediaRootId, isPathInside, type MediaRoot, toRootRelativePath } from "@mdcz/media-store";
import { buildMovieAssetFileNames, isMovieNfoBaseName, MOVIE_NFO_BASE_NAME } from "@mdcz/shared/assetNaming";
import { toErrorMessage } from "@mdcz/shared/error";
import { buildFileId } from "@mdcz/shared/mediaIdentity";
import type { CrawlerData, DiscoveredAssets, LocalScanEntry } from "@mdcz/shared/types";
import { publicationPathKey } from "../publication/paths";
import type { RegisteredMediaLocation } from "../publication/registeredOutputs";
import { isGeneratedSidecarVideo, resolveFileInfoWithSubtitles } from "../scrape";
import { throwIfAborted } from "../scrape/utils/abort";
import { DEFAULT_VIDEO_EXTENSIONS, listVideoFiles } from "../scrape/utils/filesystem";
import { parseFileInfo } from "../scrape/utils/number";
import { runtimeLoggerService } from "../shared";
import { resolveLocalAssetReference, uniqueDefinedPaths } from "./localAssetReferences";
import { parseNfoSnapshot } from "./nfoSnapshot";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
type MetadataLocation = {
  mediaPath: string;
  metadataPath: string;
  registeredOutputs?: Map<
    string,
    { nfoPath?: string; strmPath?: string; generatedStrmPaths?: string[]; assets?: DiscoveredAssets }
  >;
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
    throw error;
  }
};

const dirExists = async (path: string): Promise<boolean> => {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
    throw error;
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
  const entries = await readdir(subDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && extensions.has(extname(entry.name).toLowerCase()))
    .map((entry) => join(subDir, entry.name));
};

export class LocalScanService {
  constructor(
    private readonly registeredOutputs?: (paths: readonly string[]) => Promise<Map<string, RegisteredMediaLocation>>,
  ) {}

  private readonly logger = runtimeLoggerService.getLogger("LocalScanService");

  /**
   * Scan a directory for video files and discover their local NFO and assets.
   * This is a pure read-only operation — no files are modified.
   */
  async scan(
    root: MediaRoot,
    sceneImagesFolder: string,
    signal?: AbortSignal,
    metadata?: MetadataLocation,
  ): Promise<LocalScanEntry[]>;
  async scan(dirPath: string, sceneImagesFolder: string, signal?: AbortSignal): Promise<LocalScanEntry[]>;
  async scan(
    rootOrPath: MediaRoot | string,
    sceneImagesFolder: string,
    signal?: AbortSignal,
    metadata?: MetadataLocation,
  ): Promise<LocalScanEntry[]> {
    const root: MediaRoot =
      typeof rootOrPath === "string"
        ? {
            id: deterministicMediaRootId(rootOrPath),
            displayName: rootOrPath,
            hostPath: rootOrPath,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        : rootOrPath;
    const dirPath = root.hostPath;
    throwIfAborted(signal);
    this.logger.info(`Scanning directory: ${dirPath}`);

    const candidates = await listVideoFiles(dirPath, true, undefined, signal);
    metadata ??= this.registeredOutputs
      ? { mediaPath: "", metadataPath: "", registeredOutputs: await this.registeredOutputs(candidates) }
      : undefined;
    const generatedStrms = new Set(
      [...(metadata?.registeredOutputs?.values() ?? [])].flatMap((output) =>
        [...(output.generatedStrmPaths ?? []), ...(output.strmPath ? [output.strmPath] : [])].map(publicationPathKey),
      ),
    );
    const videoFiles = candidates.filter(
      (videoPath) => !isGeneratedSidecarVideo(videoPath) && !generatedStrms.has(publicationPathKey(videoPath)),
    );
    this.logger.info(`Found ${videoFiles.length} video file(s)`);

    const entries: LocalScanEntry[] = [];

    for (const videoPath of videoFiles) {
      throwIfAborted(signal);
      try {
        const entry = await this.scanVideo(root, videoPath, sceneImagesFolder, signal, metadata);
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

  async scanFiles(
    root: MediaRoot,
    filePaths: string[],
    sceneImagesFolder: string,
    signal?: AbortSignal,
    metadata?: MetadataLocation,
  ): Promise<LocalScanEntry[]>;
  async scanFiles(filePaths: string[], sceneImagesFolder: string, signal?: AbortSignal): Promise<LocalScanEntry[]>;
  async scanFiles(
    rootOrPaths: MediaRoot | string[],
    pathsOrSceneImagesFolder: string[] | string,
    sceneImagesFolderOrSignal?: string | AbortSignal,
    maybeSignal?: AbortSignal,
    metadata?: MetadataLocation,
  ): Promise<LocalScanEntry[]> {
    const filePaths = Array.isArray(rootOrPaths) ? rootOrPaths : (pathsOrSceneImagesFolder as string[]);
    const sceneImagesFolder = Array.isArray(rootOrPaths)
      ? (pathsOrSceneImagesFolder as string)
      : (sceneImagesFolderOrSignal as string);
    const signal = Array.isArray(rootOrPaths) ? (sceneImagesFolderOrSignal as AbortSignal | undefined) : maybeSignal;
    const root: MediaRoot = Array.isArray(rootOrPaths)
      ? {
          id: deterministicMediaRootId(filePaths[0] ? dirname(filePaths[0]) : "."),
          displayName: "扫描文件",
          hostPath: dirname(filePaths[0] ?? "."),
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      : rootOrPaths;
    throwIfAborted(signal);
    const uniqueFilePaths = [...new Set(filePaths.map((filePath) => filePath.trim()).filter(Boolean))];
    metadata ??= this.registeredOutputs
      ? { mediaPath: "", metadataPath: "", registeredOutputs: await this.registeredOutputs(uniqueFilePaths) }
      : undefined;
    const entries: LocalScanEntry[] = [];

    for (const videoPath of uniqueFilePaths) {
      throwIfAborted(signal);
      if (!DEFAULT_VIDEO_EXTENSIONS.has(extname(videoPath).toLowerCase())) {
        throw new Error(`不支持的维护视频文件：${videoPath}`);
      }

      if (
        isGeneratedSidecarVideo(videoPath) ||
        [...(metadata?.registeredOutputs?.values() ?? [])].some((output) =>
          [...(output.generatedStrmPaths ?? []), ...(output.strmPath ? [output.strmPath] : [])].some(
            (path) => publicationPathKey(path) === publicationPathKey(videoPath),
          ),
        )
      ) {
        throw new Error(`不能单独维护生成的视频附属文件：${videoPath}`);
      }

      try {
        const fileStats = await stat(videoPath);
        if (!fileStats.isFile()) {
          throw new Error("路径不是文件");
        }

        const entry = await this.scanVideo(root, videoPath, sceneImagesFolder, signal, metadata);
        entries.push(entry);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw error;
        }
        const message = toErrorMessage(error);
        throw new Error(`维护扫描失败：${videoPath}：${message}`, { cause: error });
      }
    }

    this.logger.info(`Selected-file scan complete: ${entries.length} entries`);
    return entries;
  }

  /** Scan a single video file and discover its NFO and assets. */
  async scanVideo(
    root: MediaRoot,
    videoPath: string,
    sceneImagesFolder: string,
    signal?: AbortSignal,
    metadata?: MetadataLocation,
  ): Promise<LocalScanEntry> {
    metadata ??= this.registeredOutputs
      ? { mediaPath: "", metadataPath: "", registeredOutputs: await this.registeredOutputs([videoPath]) }
      : undefined;
    throwIfAborted(signal);
    const { fileInfo } = await resolveFileInfoWithSubtitles(videoPath);
    const dir = dirname(videoPath);

    const registered = metadata?.registeredOutputs?.get(videoPath);
    const registeredPath = registered?.nfoPath ?? registered?.strmPath;
    const metadataDir = registeredPath
      ? dirname(registeredPath)
      : metadata?.metadataPath.trim() && metadata.mediaPath && isPathInside(metadata.mediaPath, dir)
        ? resolve(metadata.metadataPath, relative(metadata.mediaPath, dir))
        : dir;
    const strmPath = registered?.strmPath;
    const nfoPath = registered ? registered.nfoPath : await this.findNfo(metadataDir, fileInfo, signal);
    let crawlerData: CrawlerData | undefined;
    let nfoLocalState: LocalScanEntry["nfoLocalState"];
    let scanError = strmPath && !(await fileExists(strmPath)) ? `已登记的 STRM 不存在：${strmPath}` : undefined;

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

    const assets =
      registered?.assets ??
      (registered && !registeredPath
        ? { sceneImages: [], actorPhotos: [] }
        : await this.discoverAssets({
            dir: nfoPath ? dirname(nfoPath) : metadataDir,
            videoDir: dir,
            fileInfo,
            nfoPath,
            crawlerData,
            sceneImagesFolder,
            signal,
          }));
    for (const path of [
      assets.thumb,
      assets.poster,
      assets.fanart,
      assets.trailer,
      ...assets.sceneImages,
      ...assets.actorPhotos,
    ]) {
      if (path && !(await fileExists(path)))
        scanError = [scanError, `已登记的资源不存在：${path}`].filter(Boolean).join("；");
    }

    return {
      fileId: buildFileId(videoPath),
      ref: { rootId: root.id, relativePath: toRootRelativePath(root, videoPath) },
      fileInfo,
      nfoPath,
      strmPath,
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
    videoDir: string;
    fileInfo: LocalScanEntry["fileInfo"];
    nfoPath?: string;
    crawlerData?: CrawlerData;
    sceneImagesFolder: string;
    signal?: AbortSignal;
  }): Promise<DiscoveredAssets> {
    throwIfAborted(input.signal);

    const allowDirectoryWideAssets =
      resolve(input.dir) !== resolve(input.videoDir) ||
      (await this.isSingleMovieDirectory(input.videoDir, input.signal));
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

      const videoBaseName = fileInfo.fileName.toLowerCase();
      const partlessBaseName =
        fileInfo.part && fileInfo.fileName.endsWith(fileInfo.part.suffix)
          ? fileInfo.fileName.slice(0, -fileInfo.part.suffix.length).toLowerCase()
          : undefined;
      const singleMovieDirectory = await this.isSingleMovieDirectory(dirname(fileInfo.filePath), signal);
      const preferredBaseNames = [
        partlessBaseName,
        videoBaseName,
        singleMovieDirectory ? MOVIE_NFO_BASE_NAME : undefined,
      ].filter((value): value is string => Boolean(value));
      const match = preferredBaseNames
        .map((baseName) => nfoEntries.find((entry) => parse(entry.name).name.toLowerCase() === baseName))
        .find(Boolean);

      if (match) return join(dir, match.name);
      return nfoEntries.length === 1 && singleMovieDirectory ? join(dir, nfoEntries[0].name) : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
}

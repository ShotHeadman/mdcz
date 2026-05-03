import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { Configuration } from "@mdcz/shared/config";
import type { RuntimeNetworkClient } from "../../network";
import { CachedAsyncResolver, toErrorMessage } from "../../shared";
import { isAbortError, throwIfAborted } from "../utils/abort";
import { pathExists } from "../utils/filesystem";
import { detectImageFormat, getImageFileExtensionForFormat, validateImage } from "../utils/image";
import { sanitizePathSegment } from "../utils/path";
import { type ActorImageIndexEntry, ActorImageIndexStore } from "./ActorImageIndexStore";
import { resolveActorPhotoFolderPath, usesLocalActorImageSource } from "./actorPhotoPath";
import { toUniqueActorNames } from "./utils";

const INDEX_FILE_NAME = "index.json";
const PHOTO_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"] as const;
const DEFAULT_PHOTO_EXTENSION = ".jpg";

type ActorImageCacheLayout = {
  cacheRoot: string;
  indexPath: string;
};

interface ActorImageLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface ActorImageFileStoreDependencies {
  cacheRoot: string;
  logger: ActorImageLogger;
  networkClient?: Pick<RuntimeNetworkClient, "getContent">;
}

export type ActorImageLookupOptions = {
  fallbackBaseDir?: string;
  expectedRemoteUrl?: string;
};

const isRemoteUrl = (value: string): boolean => /^https?:\/\//iu.test(value);

const isSupportedPhotoExtension = (value: string): value is (typeof PHOTO_EXTENSIONS)[number] =>
  (PHOTO_EXTENSIONS as readonly string[]).includes(value);

const normalizePhotoExtension = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return isSupportedPhotoExtension(normalized) ? normalized : undefined;
};

const getPhotoExtensionFromUrl = (value: string): string | undefined => {
  try {
    return normalizePhotoExtension(extname(new URL(value).pathname));
  } catch {
    return undefined;
  }
};

const resolveCachedPhotoExtension = (sourceUrl: string, bytes: Uint8Array): string => {
  return (
    getImageFileExtensionForFormat(detectImageFormat(bytes) ?? undefined) ??
    getPhotoExtensionFromUrl(sourceUrl) ??
    DEFAULT_PHOTO_EXTENSION
  );
};

export class ActorImageFileStore {
  private readonly cacheLayoutResolver = new CachedAsyncResolver<string, ActorImageCacheLayout>();

  private readonly indexStore: ActorImageIndexStore;

  constructor(private readonly deps: ActorImageFileStoreDependencies) {
    this.indexStore = new ActorImageIndexStore(deps.logger);
  }

  async resolveLocalImage(
    configuration: Configuration,
    actorNames: string[],
    options: ActorImageLookupOptions = {},
  ): Promise<string | undefined> {
    const uniqueNames = toUniqueActorNames(actorNames);
    if (uniqueNames.length === 0) {
      return undefined;
    }

    const libraryRoot = usesLocalActorImageSource(configuration)
      ? resolveActorPhotoFolderPath(configuration, options)
      : undefined;
    const manualImagePath =
      libraryRoot && (await pathExists(libraryRoot)) ? await this.findManualImage(libraryRoot, uniqueNames) : undefined;
    if (manualImagePath) {
      this.deps.logger.info(`Actor photo local hit for ${uniqueNames[0] ?? "unknown"}: ${manualImagePath}`);
      const layout = await this.ensureCacheLayout();
      const index = await this.indexStore.readIndex(layout.indexPath);
      const existingEntry = this.indexStore.findEntry(index, uniqueNames);
      await this.indexStore.updateEntry(layout.indexPath, uniqueNames, (currentEntry) =>
        this.indexStore.mergeEntry(currentEntry, uniqueNames, {
          publicFileName: basename(manualImagePath),
          blobRelativePath: currentEntry?.blobRelativePath ?? existingEntry?.blobRelativePath,
        }),
      );
      return manualImagePath;
    }

    if (!options.expectedRemoteUrl) {
      return undefined;
    }

    const layout = await this.ensureCacheLayout();
    const index = await this.indexStore.readIndex(layout.indexPath);
    const existingEntry = this.indexStore.findEntry(index, uniqueNames);
    const cachedImagePath = await this.restoreCachedRemoteImage(layout, existingEntry, options.expectedRemoteUrl);
    if (cachedImagePath && existingEntry) {
      this.deps.logger.info(
        `Actor photo cache hit for ${uniqueNames[0] ?? existingEntry.displayName}: ${cachedImagePath}`,
      );
      await this.indexStore.updateEntry(layout.indexPath, uniqueNames, (currentEntry) => {
        if (!currentEntry) {
          return existingEntry;
        }

        return this.indexStore.mergeEntry(currentEntry, uniqueNames, {
          publicFileName: currentEntry.publicFileName,
          blobRelativePath: currentEntry.blobRelativePath,
          sourceUrl: currentEntry.sourceUrl,
        });
      });
    }

    return cachedImagePath;
  }

  async cacheActorImage(
    actorNames: string[],
    imageSource: string | undefined,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const source = imageSource?.trim();
    if (!source) {
      return undefined;
    }

    if (!isRemoteUrl(source)) {
      const sourceExists = await pathExists(source);
      if (sourceExists) {
        this.deps.logger.info(`Actor photo source path hit for ${actorNames[0] ?? source}: ${source}`);
      }
      return sourceExists ? source : undefined;
    }

    return await this.cacheRemoteImage(actorNames, source, signal);
  }

  private ensureCacheLayout(): Promise<ActorImageCacheLayout> {
    return this.cacheLayoutResolver.resolve("default", async () => await this.createCacheLayout());
  }

  private async createCacheLayout(): Promise<ActorImageCacheLayout> {
    const cacheRoot = this.deps.cacheRoot;
    const indexPath = join(cacheRoot, INDEX_FILE_NAME);
    const blobsDirectory = join(cacheRoot, "blobs", "sha256");

    await mkdir(blobsDirectory, { recursive: true });
    await this.indexStore.ensureIndexFile(indexPath);

    return { cacheRoot, indexPath };
  }

  private async cacheRemoteImage(
    actorNames: string[],
    remoteUrl: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    if (!this.deps.networkClient?.getContent) {
      this.deps.logger.warn(
        `Actor photo network client unavailable for ${actorNames[0] ?? remoteUrl}; resolved URL not cached`,
      );
      return undefined;
    }

    throwIfAborted(signal);

    const layout = await this.ensureCacheLayout();
    const index = await this.indexStore.readIndex(layout.indexPath);
    const existingEntry = this.indexStore.findEntry(index, actorNames);
    const existingBlobPath = existingEntry?.blobRelativePath && join(layout.cacheRoot, existingEntry.blobRelativePath);
    const normalizedRemoteUrl = remoteUrl.trim();

    if (existingBlobPath && existingEntry?.sourceUrl === normalizedRemoteUrl && (await pathExists(existingBlobPath))) {
      this.deps.logger.info(
        `Actor photo remote cache hit for ${actorNames[0] ?? existingEntry.displayName}: ${existingBlobPath}`,
      );
      await this.indexStore.updateEntry(layout.indexPath, actorNames, (currentEntry) => {
        if (!currentEntry) {
          return existingEntry;
        }

        return this.indexStore.mergeEntry(currentEntry, actorNames, {
          publicFileName: currentEntry.publicFileName,
          blobRelativePath: currentEntry.blobRelativePath,
          sourceUrl: currentEntry.sourceUrl,
        });
      });
      return existingBlobPath;
    }

    try {
      const bytes = await this.deps.networkClient.getContent(remoteUrl, {
        headers: {
          accept: "image/*",
        },
        signal,
      });
      const extension = resolveCachedPhotoExtension(remoteUrl, bytes);
      const tempPath = join(layout.cacheRoot, `.tmp-${randomUUID()}${extension}`);

      try {
        await writeFile(tempPath, Buffer.from(bytes));
        const validation = await validateImage(tempPath);
        if (!validation.valid) {
          this.deps.logger.warn(
            `Discarded invalid remote actor image for ${actorNames[0] ?? remoteUrl}: ${
              validation.reason ?? "parse_failed"
            }`,
          );
          return undefined;
        }

        const digest = createHash("sha256").update(bytes).digest("hex");
        const blobRelativePath = join("blobs", "sha256", digest.slice(0, 2), `${digest}${extension}`);
        const blobPath = join(layout.cacheRoot, blobRelativePath);
        const cachedPath = await this.writeCachedRemoteImage({
          layout,
          actorNames,
          normalizedRemoteUrl,
          blobRelativePath,
          blobPath,
          tempPath,
        });
        this.deps.logger.info(
          `Cached remote actor photo for ${actorNames[0] ?? remoteUrl}: ${remoteUrl} -> ${cachedPath}`,
        );
        return cachedPath;
      } finally {
        await rm(tempPath, { force: true }).catch(() => undefined);
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      const message = toErrorMessage(error);
      this.deps.logger.warn(`Failed to cache remote actor image for ${actorNames[0] ?? remoteUrl}: ${message}`);
      return undefined;
    }
  }

  private async writeCachedRemoteImage(input: {
    layout: ActorImageCacheLayout;
    actorNames: string[];
    normalizedRemoteUrl: string;
    blobRelativePath: string;
    blobPath: string;
    tempPath: string;
  }): Promise<string> {
    if (!(await pathExists(input.blobPath))) {
      await mkdir(dirname(input.blobPath), { recursive: true });
      await copyFile(input.tempPath, input.blobPath);
    }

    await this.indexStore.updateEntry(input.layout.indexPath, input.actorNames, (currentEntry) => {
      return this.indexStore.mergeEntry(currentEntry, input.actorNames, {
        publicFileName: currentEntry?.publicFileName,
        blobRelativePath: input.blobRelativePath,
        sourceUrl: input.normalizedRemoteUrl,
      });
    });

    return input.blobPath;
  }

  private async restoreCachedRemoteImage(
    layout: ActorImageCacheLayout,
    entry: ActorImageIndexEntry | undefined,
    expectedRemoteUrl?: string,
  ): Promise<string | undefined> {
    if (!entry?.blobRelativePath) {
      return undefined;
    }

    const cachedBlobPath = join(layout.cacheRoot, entry.blobRelativePath);
    if (!(await pathExists(cachedBlobPath))) {
      return undefined;
    }

    if (expectedRemoteUrl && entry.sourceUrl !== expectedRemoteUrl.trim()) {
      return undefined;
    }

    return cachedBlobPath;
  }

  private async findManualImage(libraryRoot: string, actorNames: string[]): Promise<string | undefined> {
    const candidatePaths = Array.from(
      new Set(
        actorNames.flatMap((name) => {
          const trimmedName = name.trim();
          const sanitizedName = sanitizePathSegment(trimmedName);
          return [trimmedName, trimmedName.replaceAll(" ", ""), sanitizedName, sanitizedName.replaceAll(" ", "")]
            .filter((value) => value.length > 0)
            .flatMap((baseName) => PHOTO_EXTENSIONS.map((extension) => join(libraryRoot, `${baseName}${extension}`)));
        }),
      ),
    );

    for (const candidatePath of candidatePaths) {
      if (await pathExists(candidatePath)) {
        return candidatePath;
      }
    }

    return undefined;
  }
}

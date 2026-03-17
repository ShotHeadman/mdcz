import { createHash, randomUUID } from "node:crypto";
import { copyFile, link, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import type { ActorSourceHint, ActorSourceProvider } from "@main/services/actorSource";
import type { Configuration } from "@main/services/config";
import { resolveActorPhotoFolderPath } from "@main/services/config/actorPhotoPath";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import { normalizeActorName, toUniqueActorNames } from "@main/utils/actor";
import { mergeActorProfiles } from "@main/utils/actorProfile";
import { CachedAsyncResolver } from "@main/utils/CachedAsyncResolver";
import { toErrorMessage } from "@main/utils/common";
import { pathExists } from "@main/utils/file";
import { validateImage } from "@main/utils/image";
import { sanitizePathSegment } from "@main/utils/path";
import type { ActorProfile } from "@shared/types";
import { app } from "electron";
import PQueue from "p-queue";
import { isAbortError, throwIfAborted } from "./scraper/abort";

const CACHE_DIR_NAME = "actor-image-cache";
const INDEX_FILE_NAME = "index.json";
const PHOTO_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"] as const;
const DEFAULT_PHOTO_EXTENSION = ".jpg";

type ActorImageIndexEntry = {
  normalizedName: string;
  displayName: string;
  aliases: string[];
  publicFileName?: string;
  blobRelativePath?: string;
  sourceUrl?: string;
};

type ActorImageIndex = {
  version: 1;
  actors: Record<string, ActorImageIndexEntry>;
};

type ActorImageLayout = {
  root: string;
  cacheRoot: string;
  indexPath: string;
};

export interface ActorImageServiceDependencies {
  networkClient?: Pick<NetworkClient, "getContent">;
}

type ActorImageLookupOptions = {
  fallbackBaseDir?: string;
  expectedRemoteUrl?: string;
};

const createEmptyIndex = (): ActorImageIndex => ({
  version: 1,
  actors: {},
});

const buildPublicFileName = (displayName: string, extension: string): string => {
  const sanitized = sanitizePathSegment(displayName) || "actor";
  return `${sanitized}${extension}`;
};

const hasActorPhoto = (profile: ActorProfile | undefined): boolean => Boolean(profile?.photo_url?.trim());
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

const detectPhotoExtension = (bytes: Uint8Array): string | undefined => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return ".jpg";
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return ".png";
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return ".webp";
  }

  return undefined;
};

const getPhotoExtensionFromRemoteUrl = (value: string): string | undefined => {
  try {
    return normalizePhotoExtension(extname(new URL(value).pathname));
  } catch {
    return undefined;
  }
};

const resolveCachedPhotoExtension = (sourceUrl: string, bytes: Uint8Array): string => {
  return detectPhotoExtension(bytes) ?? getPhotoExtensionFromRemoteUrl(sourceUrl) ?? DEFAULT_PHOTO_EXTENSION;
};

export const getActorImageCacheDirectory = (): string => join(app.getPath("userData"), CACHE_DIR_NAME);

export class ActorImageService {
  private readonly logger = loggerService.getLogger("ActorImageService");
  private readonly indexMutex = new PQueue({ concurrency: 1 });
  private readonly layoutResolver = new CachedAsyncResolver<string, ActorImageLayout>();

  constructor(private readonly deps: ActorImageServiceDependencies = {}) {}

  async resolveLocalImage(
    configuration: Configuration,
    actorNames: string[],
    options: ActorImageLookupOptions = {},
  ): Promise<string | undefined> {
    const root = resolveActorPhotoFolderPath(configuration, options);
    if (!root) return undefined;
    return this.resolveLocalImageUnsafe(root, actorNames, options);
  }

  private async resolveLocalImageUnsafe(
    root: string,
    actorNames: string[],
    options: ActorImageLookupOptions = {},
  ): Promise<string | undefined> {
    const layout = await this.ensureLayout(root);
    if (!layout) {
      return undefined;
    }

    const names = toUniqueActorNames(actorNames);
    if (names.length === 0) {
      return undefined;
    }

    const index = await this.readIndex(layout.indexPath);
    const existing = this.findEntry(index, names);
    const discoveredPath = await this.findPublicImage(layout.root, names);
    if (discoveredPath) {
      this.logger.info(`Actor photo local hit for ${names[0] ?? "unknown"}: ${discoveredPath}`);
      await this.upsertEntry(layout, names, (current) =>
        this.createOrMergeEntry(current, names, {
          publicFileName: basename(discoveredPath),
          blobRelativePath: current?.blobRelativePath ?? existing?.blobRelativePath,
        }),
      );
      return discoveredPath;
    }

    const restoredPath = await this.resolveExistingEntry(layout, existing, options.expectedRemoteUrl);
    if (restoredPath && existing) {
      this.logger.info(`Actor photo cache hit for ${names[0] ?? existing.displayName}: ${restoredPath}`);
      await this.upsertEntry(layout, names, (current) => {
        if (!current) {
          return existing;
        }
        return this.createOrMergeEntry(current, names, {
          publicFileName: current.publicFileName,
          blobRelativePath: current.blobRelativePath,
        });
      });
    }

    return restoredPath;
  }

  async materializeForMovie(movieDir: string, actorName: string, sourcePath: string): Promise<string | undefined> {
    if (!movieDir.trim() || !sourcePath.trim() || !(await pathExists(sourcePath))) {
      return undefined;
    }

    const extension = extname(sourcePath).toLowerCase() || ".jpg";
    const actorsDir = join(movieDir, ".actors");
    const targetFileName = buildPublicFileName(actorName, extension);
    const targetPath = join(actorsDir, targetFileName);

    await mkdir(actorsDir, { recursive: true });
    await rm(targetPath, { force: true });

    try {
      await link(sourcePath, targetPath);
    } catch {
      try {
        await symlink(sourcePath, targetPath, "file");
      } catch {
        await copyFile(sourcePath, targetPath);
      }
    }

    this.logger.info(`Materialized actor photo for ${actorName}: ${targetPath}`);
    return relative(movieDir, targetPath).replaceAll("\\", "/");
  }

  async prepareActorProfilesForMovie(
    configuration: Configuration,
    input: {
      movieDir: string;
      actors: string[];
      actorProfiles?: ActorProfile[];
      actorPhotoBaseDir?: string;
      actorSourceProvider?: ActorSourceProvider;
      sourceHints?: ActorSourceHint[];
      signal?: AbortSignal;
    },
  ): Promise<ActorProfile[] | undefined> {
    throwIfAborted(input.signal);

    const profileByName = new Map<string, ActorProfile>();
    for (const profile of input.actorProfiles ?? []) {
      const lookupNames = toUniqueActorNames([profile.name, ...(profile.aliases ?? [])]);
      for (const lookupName of lookupNames) {
        const normalized = normalizeActorName(lookupName);
        if (!normalized) {
          continue;
        }
        profileByName.set(normalized, profile);
      }
    }

    const preparedProfiles: ActorProfile[] = [];

    const seenActorNames = new Set<string>();
    for (const rawActorName of input.actors) {
      throwIfAborted(input.signal);
      const actorName = rawActorName.trim();
      const normalized = normalizeActorName(actorName);
      if (!normalized || seenActorNames.has(normalized)) {
        continue;
      }
      seenActorNames.add(normalized);

      const matchedProfile = profileByName.get(normalized);
      let existingProfile = matchedProfile;
      let lookupNames = toUniqueActorNames([actorName, existingProfile?.name, ...(existingProfile?.aliases ?? [])]);
      let localImagePath = await this.resolveLocalImage(configuration, lookupNames, {
        fallbackBaseDir: input.actorPhotoBaseDir,
        expectedRemoteUrl: isRemoteUrl(existingProfile?.photo_url ?? "") ? existingProfile?.photo_url : undefined,
      });

      if (!localImagePath) {
        existingProfile = await this.resolveActorProfile(
          configuration,
          actorName,
          matchedProfile,
          input.actorSourceProvider,
          input.sourceHints,
          input.signal,
        );
        lookupNames = toUniqueActorNames([actorName, existingProfile?.name, ...(existingProfile?.aliases ?? [])]);
        localImagePath = await this.resolveLocalImage(configuration, lookupNames, {
          fallbackBaseDir: input.actorPhotoBaseDir,
          expectedRemoteUrl: isRemoteUrl(existingProfile?.photo_url ?? "") ? existingProfile?.photo_url : undefined,
        });
      }

      if (!localImagePath) {
        localImagePath = await this.cacheProfileImage(
          configuration,
          lookupNames,
          existingProfile?.photo_url,
          {
            fallbackBaseDir: input.actorPhotoBaseDir,
          },
          input.signal,
        );
      }

      if (!localImagePath) {
        const refreshedProfile = await this.resolveActorProfile(
          configuration,
          actorName,
          existingProfile,
          input.actorSourceProvider,
          input.sourceHints,
          input.signal,
          { forceLookup: true },
        );

        if (refreshedProfile?.photo_url && refreshedProfile.photo_url !== existingProfile?.photo_url) {
          existingProfile = refreshedProfile;
          lookupNames = toUniqueActorNames([actorName, existingProfile.name, ...(existingProfile.aliases ?? [])]);
          localImagePath = await this.resolveLocalImage(configuration, lookupNames, {
            fallbackBaseDir: input.actorPhotoBaseDir,
            expectedRemoteUrl: isRemoteUrl(existingProfile.photo_url ?? "") ? existingProfile.photo_url : undefined,
          });

          if (!localImagePath) {
            localImagePath = await this.cacheProfileImage(
              configuration,
              lookupNames,
              existingProfile.photo_url,
              {
                fallbackBaseDir: input.actorPhotoBaseDir,
              },
              input.signal,
            );
          }
        }
      }

      throwIfAborted(input.signal);

      if (!localImagePath) {
        preparedProfiles.push({
          ...existingProfile,
          name: actorName,
          photo_url: undefined,
        });
        continue;
      }

      const relativeThumbPath = await this.materializeForMovie(input.movieDir, actorName, localImagePath);
      if (!relativeThumbPath) {
        this.logger.warn(`Failed to materialize actor photo for ${actorName} from ${localImagePath}`);
      }
      preparedProfiles.push({
        ...existingProfile,
        name: actorName,
        photo_url: relativeThumbPath,
      });
    }

    return preparedProfiles.length > 0 ? preparedProfiles : undefined;
  }

  private async resolveActorProfile(
    configuration: Configuration,
    actorName: string,
    existingProfile: ActorProfile | undefined,
    actorSourceProvider?: ActorSourceProvider,
    sourceHints?: ActorSourceHint[],
    signal?: AbortSignal,
    options: { forceLookup?: boolean } = {},
  ): Promise<ActorProfile | undefined> {
    if ((!options.forceLookup && hasActorPhoto(existingProfile)) || !actorSourceProvider) {
      return existingProfile;
    }

    throwIfAborted(signal);

    const lookup = await actorSourceProvider.lookup(configuration, {
      name: actorName,
      aliases: existingProfile?.aliases,
      requiredField: "photo_url",
      sourceHints,
    });

    throwIfAborted(signal);

    if (lookup.profile.photo_url) {
      this.logger.info(
        `Resolved actor photo URL for ${actorName} from ${lookup.profileSources.photo_url ?? "unknown"}: ${lookup.profile.photo_url}`,
      );
    }

    return (
      mergeActorProfiles(
        [
          { name: actorName, aliases: existingProfile?.aliases },
          ...(options.forceLookup ? [lookup.profile, existingProfile] : [existingProfile, lookup.profile]),
        ].filter((profile): profile is ActorProfile => Boolean(profile)),
      ) ?? existingProfile
    );
  }

  private async cacheProfileImage(
    configuration: Configuration,
    names: string[],
    profilePhotoUrl: string | undefined,
    options: ActorImageLookupOptions = {},
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const source = profilePhotoUrl?.trim();
    if (!source) {
      return undefined;
    }

    if (!isRemoteUrl(source)) {
      const sourceExists = await pathExists(source);
      if (sourceExists) {
        this.logger.info(`Actor photo source path hit for ${names[0] ?? source}: ${source}`);
      }
      return sourceExists ? source : undefined;
    }

    const root = resolveActorPhotoFolderPath(configuration, options);
    if (!root) {
      this.logger.warn(`Actor photo cache root unavailable for ${names[0] ?? source}; resolved URL not cached`);
      return undefined;
    }

    return this.cacheRemoteImageUnsafe(root, names, source, signal);
  }

  private ensureLayout(root: string): Promise<ActorImageLayout | null> {
    if (!root) return Promise.resolve(null);
    return this.layoutResolver.resolve(root, (key) => this.initLayout(key));
  }

  private async initLayout(root: string): Promise<ActorImageLayout> {
    const cacheRoot = getActorImageCacheDirectory();
    const indexPath = join(cacheRoot, INDEX_FILE_NAME);
    const blobsDir = join(cacheRoot, "blobs", "sha256");

    await mkdir(root, { recursive: true });
    await mkdir(blobsDir, { recursive: true });

    if (!(await pathExists(indexPath))) {
      await this.writeIndex(indexPath, createEmptyIndex());
    }

    return { root, cacheRoot, indexPath };
  }

  private async cacheRemoteImageUnsafe(
    root: string,
    names: string[],
    remoteUrl: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    if (!this.deps.networkClient) {
      this.logger.warn(`Actor photo network client unavailable for ${names[0] ?? remoteUrl}; resolved URL not cached`);
      return undefined;
    }

    throwIfAborted(signal);

    const layout = await this.ensureLayout(root);
    if (!layout) {
      return undefined;
    }

    const index = await this.readIndex(layout.indexPath);
    const existing = this.findEntry(index, names);
    const existingBlobPath = existing?.blobRelativePath && join(layout.cacheRoot, existing.blobRelativePath);
    const normalizedRemoteUrl = remoteUrl.trim();

    if (existingBlobPath && existing?.sourceUrl === normalizedRemoteUrl && (await pathExists(existingBlobPath))) {
      this.logger.info(`Actor photo remote cache hit for ${names[0] ?? existing.displayName}: ${existingBlobPath}`);
      await this.upsertEntry(layout, names, (current) => {
        if (!current) {
          return existing;
        }
        return this.createOrMergeEntry(current, names, {
          publicFileName: current.publicFileName,
          blobRelativePath: current.blobRelativePath,
          sourceUrl: current.sourceUrl,
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
          this.logger.warn(
            `Discarded invalid remote actor image for ${names[0] ?? remoteUrl}: ${validation.reason ?? "parse_failed"}`,
          );
          return undefined;
        }

        const digest = createHash("sha256").update(bytes).digest("hex");
        const blobRelativePath = join("blobs", "sha256", digest.slice(0, 2), `${digest}${extension}`);
        const blobPath = join(layout.cacheRoot, blobRelativePath);
        return await this.indexMutex.add(async () => {
          const currentIndex = await this.readIndex(layout.indexPath);
          const current = this.findEntry(currentIndex, names);
          const currentBlobPath = current?.blobRelativePath && join(layout.cacheRoot, current.blobRelativePath);

          if (currentBlobPath && current?.sourceUrl === normalizedRemoteUrl && (await pathExists(currentBlobPath))) {
            const nextEntry = this.createOrMergeEntry(current, names, {
              publicFileName: current.publicFileName,
              blobRelativePath: current.blobRelativePath,
              sourceUrl: current.sourceUrl,
            });
            await this.writeEntryIfChanged(layout.indexPath, currentIndex, current, nextEntry);
            return currentBlobPath;
          }

          if (!(await pathExists(blobPath))) {
            await mkdir(dirname(blobPath), { recursive: true });
            await copyFile(tempPath, blobPath);
          }

          const nextEntry = this.createOrMergeEntry(current, names, {
            publicFileName: current?.publicFileName,
            blobRelativePath,
            sourceUrl: normalizedRemoteUrl,
          });
          await this.writeEntryIfChanged(layout.indexPath, currentIndex, current, nextEntry);
          this.logger.info(`Cached remote actor photo for ${names[0] ?? remoteUrl}: ${remoteUrl} -> ${blobPath}`);
          return blobPath;
        });
      } finally {
        await rm(tempPath, { force: true }).catch(() => undefined);
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      const message = toErrorMessage(error);
      this.logger.warn(`Failed to cache remote actor image for ${names[0] ?? remoteUrl}: ${message}`);
      return undefined;
    }
  }

  private async readIndex(indexPath: string): Promise<ActorImageIndex> {
    return this.readJson(indexPath, createEmptyIndex());
  }

  private async writeIndex(indexPath: string, index: ActorImageIndex): Promise<void> {
    await this.writeJson(indexPath, index);
  }

  private async readJson<T>(filePath: string, fallback: T): Promise<T> {
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        await this.writeJson(filePath, fallback);
        return fallback;
      }
      throw error;
    }

    try {
      return JSON.parse(raw) as T;
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError);
      this.logger.warn(`Corrupt JSON at ${filePath}, returning empty state (file preserved): ${message}`);
      return fallback;
    }
  }

  private async writeJson(filePath: string, value: unknown): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  private findEntry(index: ActorImageIndex, names: string[]): ActorImageIndexEntry | undefined {
    const normalizedNames = names.map((name) => normalizeActorName(name)).filter((name) => name.length > 0);
    for (const normalizedName of normalizedNames) {
      const direct = index.actors[normalizedName];
      if (direct) {
        return direct;
      }
    }

    const normalizedSet = new Set(normalizedNames);
    for (const entry of Object.values(index.actors)) {
      if (normalizedSet.has(entry.normalizedName)) {
        return entry;
      }

      if (entry.aliases.some((alias) => normalizedSet.has(normalizeActorName(alias)))) {
        return entry;
      }
    }

    return undefined;
  }

  private async resolveExistingEntry(
    layout: ActorImageLayout,
    entry: ActorImageIndexEntry | undefined,
    expectedRemoteUrl?: string,
  ): Promise<string | undefined> {
    if (entry?.publicFileName) {
      const publicPath = join(layout.root, entry.publicFileName);
      if (await pathExists(publicPath)) {
        return publicPath;
      }
    }

    if (!entry?.blobRelativePath) {
      return undefined;
    }

    const blobPath = join(layout.cacheRoot, entry.blobRelativePath);
    if (!(await pathExists(blobPath))) {
      return undefined;
    }

    if (expectedRemoteUrl && entry.sourceUrl !== expectedRemoteUrl.trim()) {
      return undefined;
    }

    return blobPath;
  }

  private async findPublicImage(root: string, names: string[]): Promise<string | undefined> {
    const candidates = Array.from(
      new Set(
        names.flatMap((name) => {
          const trimmed = name.trim();
          const sanitized = sanitizePathSegment(trimmed);
          return [trimmed, trimmed.replaceAll(" ", ""), sanitized, sanitized.replaceAll(" ", "")]
            .filter((value) => value.length > 0)
            .flatMap((baseName) => PHOTO_EXTENSIONS.map((extension) => join(root, `${baseName}${extension}`)));
        }),
      ),
    );

    for (const candidate of candidates) {
      if (await pathExists(candidate)) {
        return candidate;
      }
    }

    return undefined;
  }

  private createOrMergeEntry(
    existing: ActorImageIndexEntry | undefined,
    names: string[],
    next: Pick<ActorImageIndexEntry, "publicFileName" | "blobRelativePath" | "sourceUrl">,
  ): ActorImageIndexEntry {
    const canonicalName = existing?.displayName ?? names[0] ?? "";
    const normalizedName = existing?.normalizedName ?? normalizeActorName(canonicalName);
    const aliases = toUniqueActorNames([...(existing?.aliases ?? []), ...names]).filter(
      (alias) => normalizeActorName(alias) !== normalizedName,
    );

    return {
      normalizedName,
      displayName: canonicalName,
      aliases,
      publicFileName: next.publicFileName ?? existing?.publicFileName,
      blobRelativePath: next.blobRelativePath ?? existing?.blobRelativePath,
      sourceUrl: next.sourceUrl ?? existing?.sourceUrl,
    };
  }

  private async upsertEntry(
    layout: ActorImageLayout,
    names: string[],
    buildEntry: (existing: ActorImageIndexEntry | undefined) => ActorImageIndexEntry | undefined,
  ): Promise<void> {
    await this.indexMutex.add(async () => {
      const index = await this.readIndex(layout.indexPath);
      const existing = this.findEntry(index, names);
      const nextEntry = buildEntry(existing);
      if (!nextEntry) {
        return;
      }
      await this.writeEntryIfChanged(layout.indexPath, index, existing, nextEntry);
    });
  }

  private async writeEntryIfChanged(
    indexPath: string,
    index: ActorImageIndex,
    existing: ActorImageIndexEntry | undefined,
    nextEntry: ActorImageIndexEntry,
  ): Promise<void> {
    if (existing && this.isSameEntry(existing, nextEntry)) {
      return;
    }

    index.actors[nextEntry.normalizedName] = nextEntry;
    if (existing && existing.normalizedName !== nextEntry.normalizedName) {
      delete index.actors[existing.normalizedName];
    }
    await this.writeIndex(indexPath, index);
  }

  private isSameEntry(left: ActorImageIndexEntry, right: ActorImageIndexEntry): boolean {
    return (
      left.normalizedName === right.normalizedName &&
      left.displayName === right.displayName &&
      left.publicFileName === right.publicFileName &&
      left.blobRelativePath === right.blobRelativePath &&
      left.sourceUrl === right.sourceUrl &&
      left.aliases.length === right.aliases.length &&
      left.aliases.every((alias, index) => alias === right.aliases[index])
    );
  }
}

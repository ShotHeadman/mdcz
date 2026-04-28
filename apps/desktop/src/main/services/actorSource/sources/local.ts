import { readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { ActorImageService } from "@main/services/ActorImageService";
import type { Configuration } from "@main/services/config";
import { resolveActorPhotoFolderPath } from "@main/services/config/actorPhotoPath";
import { normalizeActorName } from "@main/utils/actor";
import { CachedAsyncResolver } from "@main/utils/CachedAsyncResolver";
import { toErrorMessage } from "@main/utils/common";
import { listFiles, pathExists } from "@main/utils/file";
import { parseNfo } from "@main/utils/nfo";
import type { ActorProfile } from "@mdcz/shared/types";
import { mergeActorSourceHints } from "../sourceHints";
import type { ActorLookupQuery, ActorSourceHint, ActorSourceResult, BaseActorSource } from "../types";

const INDEX_CACHE_TTL_MS = 5 * 60 * 1000;

type IndexedActorProfile = ActorProfile & {
  aliases: string[];
};

interface IndexedActorRecord {
  profile: IndexedActorProfile;
  sourceHints: ActorSourceHint[];
}

const isRemoteUrl = (value: string): boolean => /^https?:\/\//iu.test(value);

const mergeProfiles = (
  existing: IndexedActorProfile | undefined,
  incoming: IndexedActorProfile,
): IndexedActorProfile => {
  const existingPhoto = existing?.photo_url;
  const incomingPhoto = incoming.photo_url;

  const nextPhoto = (() => {
    if (!existingPhoto) {
      return incomingPhoto;
    }
    if (!incomingPhoto) {
      return existingPhoto;
    }
    if (isRemoteUrl(existingPhoto) && !isRemoteUrl(incomingPhoto)) {
      return incomingPhoto;
    }
    return existingPhoto;
  })();

  const merged: IndexedActorProfile = {
    name: existing?.name ?? incoming.name,
    aliases: [],
    photo_url: nextPhoto,
  };

  return merged;
};

const mergeRecords = (existing: IndexedActorRecord | undefined, incoming: IndexedActorRecord): IndexedActorRecord => {
  return {
    profile: mergeProfiles(existing?.profile, incoming.profile),
    sourceHints: mergeActorSourceHints(existing?.sourceHints, incoming.sourceHints),
  };
};

const createSourceHints = (parsed: ReturnType<typeof parseNfo>): ActorSourceHint[] => {
  return mergeActorSourceHints([
    {
      website: parsed.website,
      studio: parsed.studio,
      publisher: parsed.publisher,
    },
  ]);
};

const isPathInside = (rootPath: string, candidatePath: string): boolean => {
  const normalizedRoot = resolve(rootPath)
    .replace(/[\\/]+$/u, "")
    .toLowerCase();
  const normalizedCandidate = resolve(candidatePath).toLowerCase();
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}\\`) ||
    normalizedCandidate.startsWith(`${normalizedRoot}/`)
  );
};

const resolveActorPhotoUrl = async (
  configuration: Configuration,
  nfoPath: string,
  profile: ActorProfile,
): Promise<string | undefined> => {
  if (!profile.photo_url || isRemoteUrl(profile.photo_url)) {
    return undefined;
  }

  const absolutePath = isAbsolute(profile.photo_url) ? profile.photo_url : join(dirname(nfoPath), profile.photo_url);
  if (!(await pathExists(absolutePath))) {
    return undefined;
  }

  const actorPhotoRoot = resolveActorPhotoFolderPath(configuration);
  if (!actorPhotoRoot || !isPathInside(actorPhotoRoot, absolutePath)) {
    return undefined;
  }

  return absolutePath;
};

const buildLocalActorRecordIndex = async (configuration: Configuration): Promise<Map<string, IndexedActorRecord>> => {
  const mediaPath = configuration.paths.mediaPath.trim();
  if (!mediaPath) {
    return new Map<string, IndexedActorRecord>();
  }

  let files: string[];
  try {
    files = await listFiles(mediaPath, true);
  } catch {
    return new Map<string, IndexedActorRecord>();
  }

  const nfoFiles = files.filter((filePath) => extname(filePath).toLowerCase() === ".nfo");
  const index = new Map<string, IndexedActorRecord>();

  for (const nfoPath of nfoFiles) {
    try {
      const xml = await readFile(nfoPath, "utf8");
      const parsed = parseNfo(xml);
      const sourceHints = createSourceHints(parsed);
      const profilesByName = new Map<string, IndexedActorProfile>();

      for (const actorName of parsed.actors) {
        const name = actorName.trim();
        if (!name) {
          continue;
        }

        profilesByName.set(normalizeActorName(name), {
          name,
          aliases: [],
          photo_url: undefined,
        });
      }

      for (const profile of parsed.actor_profiles ?? []) {
        const name = profile.name.trim();
        if (!name) {
          continue;
        }

        const key = normalizeActorName(name);
        const nextProfile = mergeProfiles(profilesByName.get(key), {
          name,
          aliases: [],
          photo_url: await resolveActorPhotoUrl(configuration, nfoPath, profile),
        });
        profilesByName.set(key, nextProfile);
      }

      for (const nextProfile of profilesByName.values()) {
        const merged = mergeRecords(index.get(normalizeActorName(nextProfile.name)), {
          profile: nextProfile,
          sourceHints,
        });

        const normalized = normalizeActorName(merged.profile.name);
        if (normalized) {
          index.set(normalized, merged);
        }
      }
    } catch {
      // Ignore unrelated or invalid NFO files when building local actor sources.
    }
  }

  return index;
};

export const buildLocalActorIndex = async (configuration: Configuration): Promise<Map<string, IndexedActorProfile>> => {
  const recordIndex = await buildLocalActorRecordIndex(configuration);
  return new Map(Array.from(recordIndex.entries(), ([key, value]) => [key, value.profile]));
};

export class LocalActorSource implements BaseActorSource {
  readonly name = "local" as const;

  private readonly indexResolver = new CachedAsyncResolver<string, Map<string, IndexedActorRecord>>();

  private indexBucket = "";

  constructor(private readonly actorImageService = new ActorImageService()) {}

  async lookup(configuration: Configuration, query: ActorLookupQuery): Promise<ActorSourceResult> {
    try {
      const index = await this.loadIndex(configuration);
      const indexed = index.get(normalizeActorName(query.name));
      const profile = indexed?.profile;
      const aliases = profile?.aliases ?? [];
      const localPhotoPath = await this.actorImageService.resolveLocalImage(configuration, [
        query.name,
        ...(query.aliases ?? []),
        ...aliases,
      ]);

      return {
        source: this.name,
        success: true,
        profile: {
          name: profile?.name ?? query.name.trim(),
          photo_url: localPhotoPath ?? profile?.photo_url,
        },
        warnings: [],
        sourceHints: indexed?.sourceHints ?? [],
      };
    } catch (error) {
      const message = toErrorMessage(error);
      return {
        source: this.name,
        success: false,
        warnings: [`Failed to load local actor data: ${message}`],
      };
    }
  }

  private async loadIndex(configuration: Configuration): Promise<Map<string, IndexedActorRecord>> {
    const bucket = String(Math.floor(Date.now() / INDEX_CACHE_TTL_MS));
    if (bucket !== this.indexBucket) {
      this.indexResolver.clear();
      this.indexBucket = bucket;
    }

    const cacheKey = JSON.stringify({
      mediaPath: configuration.paths.mediaPath.trim(),
      actorPhotoFolder: configuration.paths.actorPhotoFolder.trim(),
    });

    return this.indexResolver.resolve(cacheKey, async () => buildLocalActorRecordIndex(configuration));
  }
}

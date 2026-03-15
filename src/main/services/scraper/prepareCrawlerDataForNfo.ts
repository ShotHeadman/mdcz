import { dirname, join } from "node:path";
import type { ActorImageService } from "@main/services/ActorImageService";
import type { ActorSourceProvider } from "@main/services/actorSource";
import { mergeActorSourceHints } from "@main/services/actorSource/sourceHints";
import type { Configuration } from "@main/services/config";
import type { ActorProfile, CrawlerData } from "@shared/types";
import { throwIfAborted } from "./abort";

const isRemoteActorPhoto = (value: string): boolean => /^https?:\/\//iu.test(value);
const toRemoteImageSourceUrl = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized && /^https?:\/\//iu.test(normalized) ? normalized : undefined;
};

const toLocalActorPhotoPaths = (movieDir: string, actorProfiles: ActorProfile[] | undefined): string[] => {
  const resolvedPaths: string[] = [];
  const seen = new Set<string>();

  for (const profile of actorProfiles ?? []) {
    const photoUrl = profile.photo_url?.trim();
    if (!photoUrl || isRemoteActorPhoto(photoUrl)) {
      continue;
    }

    const resolvedPath = join(movieDir, photoUrl);
    if (seen.has(resolvedPath)) {
      continue;
    }

    seen.add(resolvedPath);
    resolvedPaths.push(resolvedPath);
  }

  return resolvedPaths;
};

const withPersistedImageSourceUrls = (crawlerData: CrawlerData): CrawlerData => {
  const thumbSourceUrl = crawlerData.thumb_source_url ?? toRemoteImageSourceUrl(crawlerData.thumb_url);
  const posterSourceUrl = crawlerData.poster_source_url ?? toRemoteImageSourceUrl(crawlerData.poster_url);
  const fanartSourceUrl =
    crawlerData.fanart_source_url ??
    toRemoteImageSourceUrl(crawlerData.fanart_url) ??
    thumbSourceUrl ??
    toRemoteImageSourceUrl(crawlerData.thumb_url);

  return {
    ...crawlerData,
    thumb_source_url: thumbSourceUrl,
    poster_source_url: posterSourceUrl,
    fanart_source_url: fanartSourceUrl,
  };
};

export const prepareCrawlerDataForNfo = async (
  actorImageService: ActorImageService,
  configuration: Configuration,
  crawlerData: CrawlerData,
  options: {
    movieDir: string;
    sourceVideoPath: string;
    actorSourceProvider?: ActorSourceProvider;
    signal?: AbortSignal;
  },
): Promise<{ data: CrawlerData; actorPhotoPaths: string[] }> => {
  throwIfAborted(options.signal);

  const actorProfiles = await actorImageService.prepareActorProfilesForMovie(configuration, {
    movieDir: options.movieDir,
    actors: crawlerData.actors,
    actorProfiles: crawlerData.actor_profiles,
    actorPhotoBaseDir: dirname(options.sourceVideoPath),
    actorSourceProvider: options.actorSourceProvider,
    signal: options.signal,
    sourceHints: mergeActorSourceHints([
      {
        website: crawlerData.website,
        studio: crawlerData.studio,
        publisher: crawlerData.publisher,
      },
    ]),
  });

  throwIfAborted(options.signal);

  return {
    data: {
      ...withPersistedImageSourceUrls(crawlerData),
      actor_profiles: actorProfiles,
    },
    actorPhotoPaths: toLocalActorPhotoPaths(options.movieDir, actorProfiles),
  };
};

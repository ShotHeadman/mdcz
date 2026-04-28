import type { Configuration } from "@main/services/config";
import type { NetworkClient } from "@main/services/network";
import { normalizeActorName } from "@main/utils/actor";
import { CachedAsyncResolver } from "@main/utils/CachedAsyncResolver";
import { toErrorMessage } from "@main/utils/common";
import type { ActorLookupQuery, ActorSourceResult, BaseActorSource } from "../types";

interface GfriendsResponse {
  Content?: Record<string, Record<string, string>>;
}

interface GfriendsCandidate {
  url: string;
  variant: number | null;
}

const DEFAULT_GFRIENDS_FILETREE_URL = "https://raw.githubusercontent.com/gfriends/gfriends/master/Filetree.json";
const MAP_CACHE_TTL_MS = 30 * 60 * 1000;

const stripFileExtension = (value: string): string => value.replace(/\.[a-z0-9]+$/iu, "");

const parseVariantSuffix = (value: string): { baseName: string; variant: number | null } => {
  const match = value.match(/^(.*?)-(\d+)$/u);
  if (!match) {
    return {
      baseName: value,
      variant: null,
    };
  }

  const baseName = match[1].trim();
  if (!baseName) {
    return {
      baseName: value,
      variant: null,
    };
  }

  return {
    baseName,
    variant: Number.parseInt(match[2], 10),
  };
};

const normalizeGfriendsActorName = (value: string): string => {
  const { baseName } = parseVariantSuffix(stripFileExtension(value.trim()));
  return normalizeActorName(baseName);
};

export interface GfriendsActorSourceDependencies {
  networkClient: NetworkClient;
  actorMapUrl?: string;
}

export class GfriendsActorSource implements BaseActorSource {
  readonly name = "gfriends" as const;

  private readonly actorMapUrl: string;

  private readonly mapResolver = new CachedAsyncResolver<string, Map<string, GfriendsCandidate[]>>();

  private readonly bestCandidateResolver = new CachedAsyncResolver<string, string | undefined>();

  private mapBucket = "";

  constructor(private readonly deps: GfriendsActorSourceDependencies) {
    this.actorMapUrl = deps.actorMapUrl ?? DEFAULT_GFRIENDS_FILETREE_URL;
  }

  async lookup(_configuration: Configuration, query: ActorLookupQuery): Promise<ActorSourceResult> {
    try {
      const actorMap = await this.loadMap();
      const actorNames = [query.name, ...(query.aliases ?? [])];

      for (const actorName of actorNames) {
        const normalizedName = normalizeActorName(actorName);
        const candidates = actorMap.get(normalizedName);
        if (!candidates?.length) {
          continue;
        }

        const photoUrl = await this.selectBestCandidate(normalizedName, candidates);
        if (!photoUrl) {
          continue;
        }

        return {
          source: this.name,
          success: true,
          profile: {
            name: query.name.trim(),
            photo_url: photoUrl,
          },
          warnings: [],
        };
      }

      return {
        source: this.name,
        success: true,
        warnings: [],
      };
    } catch (error) {
      const message = toErrorMessage(error);
      return {
        source: this.name,
        success: false,
        warnings: [`Failed to load gfriends actor index: ${message}`],
      };
    }
  }

  private async loadMap(): Promise<Map<string, GfriendsCandidate[]>> {
    const bucket = String(Math.floor(Date.now() / MAP_CACHE_TTL_MS));
    if (bucket !== this.mapBucket) {
      this.mapResolver.clear();
      this.bestCandidateResolver.clear();
      this.mapBucket = bucket;
    }

    return this.mapResolver.resolve(this.actorMapUrl, async () => {
      const rawBase = this.actorMapUrl.replace(/\/Filetree\.json$/u, "").replace(/\/+$/u, "");
      const payload = await this.deps.networkClient.getJson<GfriendsResponse>(this.actorMapUrl);
      const actorMap = new Map<string, GfriendsCandidate[]>();

      if (!payload.Content) {
        return actorMap;
      }

      for (const [folder, files] of Object.entries(payload.Content)) {
        for (const [filetreeKey, fileName] of Object.entries(files)) {
          // gfriends currently stores actor entries as filename-like keys such as
          // "Actor A.jpg" or "Actor A-1.jpg", not clean actor names.
          const normalized = normalizeGfriendsActorName(filetreeKey);
          if (!normalized || !fileName) {
            continue;
          }

          const candidateUrl = `${rawBase}/Content/${folder}/${fileName}`;
          const { variant } = parseVariantSuffix(stripFileExtension(filetreeKey.trim()));
          const nextCandidates = actorMap.get(normalized) ?? [];
          if (nextCandidates.some((candidate) => candidate.url === candidateUrl)) {
            continue;
          }

          nextCandidates.push({
            url: candidateUrl,
            variant,
          });
          actorMap.set(normalized, nextCandidates);
        }
      }

      return actorMap;
    });
  }

  private async selectBestCandidate(
    actorName: string,
    candidates: readonly GfriendsCandidate[],
  ): Promise<string | undefined> {
    if (candidates.length === 1) {
      return candidates[0]?.url;
    }

    const cacheKey = JSON.stringify({
      actorName,
      candidates: candidates.map((candidate) => candidate.url),
    });

    return this.bestCandidateResolver.resolve(cacheKey, async () => {
      const measured = await Promise.all(
        candidates.map(async (candidate, index) => {
          try {
            const probe = await this.deps.networkClient.probe(candidate.url, {
              captureImageSize: true,
            });

            return {
              candidate,
              index,
              area: (probe.width ?? 0) * (probe.height ?? 0),
              contentLength: probe.contentLength ?? -1,
            };
          } catch {
            return {
              candidate,
              index,
              area: -1,
              contentLength: -1,
            };
          }
        }),
      );

      measured.sort((left, right) => {
        if (right.area !== left.area) {
          return right.area - left.area;
        }
        if (right.contentLength !== left.contentLength) {
          return right.contentLength - left.contentLength;
        }
        if ((right.candidate.variant ?? -1) !== (left.candidate.variant ?? -1)) {
          return (right.candidate.variant ?? -1) - (left.candidate.variant ?? -1);
        }
        return left.index - right.index;
      });

      return measured[0]?.candidate.url;
    });
  }
}

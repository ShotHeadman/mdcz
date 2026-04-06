import { CachedAsyncResolver } from "@main/utils/CachedAsyncResolver";
import { findMappedActorName } from "@main/utils/translate";
import type { ActorProfile } from "@shared/types";
import { normalizeTermKey } from "./shared";

export class ActorNameNormalizer {
  private readonly actorResolver = new CachedAsyncResolver<string, string>();

  private buildActorCacheKey(term: string): string {
    return normalizeTermKey(term);
  }

  async normalizeAlias(term: string): Promise<string> {
    const normalized = term.trim();
    if (!normalized) {
      return "";
    }

    const cacheKey = this.buildActorCacheKey(normalized);

    return this.actorResolver.resolve(cacheKey, async () => {
      const actorCanonical = await findMappedActorName(normalized, "jp");
      const result = actorCanonical?.trim() || normalized;
      return result.length > 0 ? result : normalized;
    });
  }

  async normalizeProfile(profile: ActorProfile): Promise<ActorProfile> {
    const originalName = profile.name.trim();
    if (!originalName) {
      return profile;
    }

    const normalizedName = await this.normalizeAlias(originalName);
    const nextName = normalizedName || originalName;
    const aliasCandidates = [originalName, ...(profile.aliases ?? [])]
      .map((alias) => alias.trim())
      .filter((alias) => alias.length > 0 && alias !== nextName);

    return {
      ...profile,
      name: nextName,
      aliases: aliasCandidates.length > 0 ? Array.from(new Set(aliasCandidates)) : profile.aliases,
    };
  }
}

import { hasActorProfileContent } from "@main/utils/actorProfile";
import { CachedAsyncResolver } from "@main/utils/CachedAsyncResolver";
import { Website } from "@shared/enums";
import type { ActorSourceHint } from "../../../types";
import { createCacheBucket, hasMatchingName, matchesSourceHost, OFFICIAL_HEADERS } from "../shared";
import type {
  OfficialActorSourceDependencies,
  OfficialLookupRequest,
  OfficialLookupResult,
  OfficialSiteAdapter,
} from "../types";
import { parseFalenoLikeDetail, parseFalenoLikeRoster } from "./falenoLike";

const DAHLIA_BASE_URL = "https://dahlia-av.jp";
const DAHLIA_STUDIO_PATTERN = /(dahlia|ダリア)/iu;

export class DahliaOfficialAdapter implements OfficialSiteAdapter {
  readonly key = "dahlia";

  private readonly rosterResolver = new CachedAsyncResolver<string, ReturnType<typeof parseFalenoLikeRoster>>();

  private rosterBucket = "";

  constructor(private readonly deps: OfficialActorSourceDependencies) {
    deps.networkClient.setDomainLimit?.("dahlia-av.jp", 1, 1);
  }

  matchesHints(hints: ActorSourceHint[]): boolean {
    return hints.some(
      (hint) =>
        hint.website === Website.DAHLIA ||
        DAHLIA_STUDIO_PATTERN.test(hint.studio ?? "") ||
        DAHLIA_STUDIO_PATTERN.test(hint.publisher ?? "") ||
        matchesSourceHost(hint, "dahlia-av.jp"),
    );
  }

  async lookup(query: OfficialLookupRequest): Promise<OfficialLookupResult | null> {
    const roster = await this.loadRoster();
    const actress = roster.find((entry) => hasMatchingName(query.queryNames, [entry.name, ...entry.aliases]));
    if (!actress?.url) {
      return null;
    }

    const html = await this.deps.networkClient.getText(actress.url, {
      headers: OFFICIAL_HEADERS,
    });
    const profile =
      parseFalenoLikeDetail(html, DAHLIA_BASE_URL, actress.name || query.fallbackName) ??
      (actress.photoUrl
        ? {
            name: actress.name,
            aliases: actress.aliases.length > 0 ? actress.aliases : undefined,
            photo_url: actress.photoUrl,
          }
        : null);
    if (!profile || !hasActorProfileContent(profile)) {
      return null;
    }

    return {
      profile,
      sourceHints: [
        {
          website: Website.DAHLIA,
          studio: "DAHLIA",
          sourceUrl: actress.url,
        },
      ],
    };
  }

  private async loadRoster() {
    const bucket = createCacheBucket();
    if (bucket !== this.rosterBucket) {
      this.rosterResolver.clear();
      this.rosterBucket = bucket;
    }

    return this.rosterResolver.resolve(this.key, async () => {
      const html = await this.deps.networkClient.getText(new URL("/actress/", DAHLIA_BASE_URL).toString(), {
        headers: OFFICIAL_HEADERS,
      });
      return parseFalenoLikeRoster(html, DAHLIA_BASE_URL);
    });
  }
}

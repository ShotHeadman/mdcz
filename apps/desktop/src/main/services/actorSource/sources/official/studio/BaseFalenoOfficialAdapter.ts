import { hasActorProfileContent } from "@main/utils/actorProfile";
import type { Website } from "@mdcz/shared/enums";
import { hasMatchingName, OFFICIAL_HEADERS } from "../shared";
import type { OfficialActorSourceDependencies, OfficialLookupRequest, OfficialLookupResult } from "../types";
import { BaseStudioOfficialAdapter } from "./BaseStudioOfficialAdapter";
import { parseFalenoDetail, parseFalenoRoster } from "./falenoParser";

interface FalenoOfficialAdapterConfig {
  key: string;
  baseUrl: string;
  hintHosts: string[];
  rateLimitedHosts: string[];
  rosterPath: string;
  studio: string;
  studioPattern: RegExp;
  website: Website;
}

export abstract class BaseFalenoOfficialAdapter extends BaseStudioOfficialAdapter<
  ReturnType<typeof parseFalenoRoster>
> {
  protected constructor(
    deps: OfficialActorSourceDependencies,
    protected readonly config: FalenoOfficialAdapterConfig,
  ) {
    super(deps, {
      key: config.key,
      website: config.website,
      studioPattern: config.studioPattern,
      hintHosts: config.hintHosts,
      rateLimitedHosts: config.rateLimitedHosts,
    });
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
      parseFalenoDetail(html, this.config.baseUrl, actress.name || query.fallbackName) ??
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
          website: this.config.website,
          studio: this.config.studio,
          sourceUrl: actress.url,
        },
      ],
    };
  }

  private async loadRoster() {
    return await this.loadCachedRoster(async () => {
      const html = await this.deps.networkClient.getText(
        new URL(this.config.rosterPath, this.config.baseUrl).toString(),
        {
          headers: OFFICIAL_HEADERS,
        },
      );
      return parseFalenoRoster(html, this.config.baseUrl);
    });
  }
}

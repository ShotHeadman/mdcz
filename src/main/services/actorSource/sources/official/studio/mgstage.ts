import { CachedAsyncResolver } from "@main/utils/CachedAsyncResolver";
import { Website } from "@shared/enums";
import { load } from "cheerio";
import type { ActorSourceHint } from "../../../types";
import {
  createCacheBucket,
  hasMatchingName,
  MGSTAGE_HEADERS,
  matchesSourceHost,
  type OfficialActressSummary,
  toAbsoluteUrl,
  toNonEmptyString,
  toUniqueNames,
} from "../shared";
import type {
  OfficialActorSourceDependencies,
  OfficialLookupRequest,
  OfficialLookupResult,
  OfficialSiteAdapter,
} from "../types";

const MGSTAGE_BASE_URL = "https://www.mgstage.com";
const MGSTAGE_ASSET_BASE_URL = "https://static.mgstage.com";

const parseMgstageRoster = (html: string): OfficialActressSummary[] => {
  const $ = load(html);
  const seen = new Set<string>();
  const roster: OfficialActressSummary[] = [];

  for (const element of $("a.act_link").toArray()) {
    const item = $(element);
    const name = toNonEmptyString(item.find("p").first().text()) ?? toNonEmptyString(item.text()) ?? "";
    const normalizedName = name ? name.replace(/\s+/gu, "") : "";
    if (!normalizedName || seen.has(normalizedName)) {
      continue;
    }

    seen.add(normalizedName);
    roster.push({
      name,
      aliases: [],
      url: toAbsoluteUrl(MGSTAGE_BASE_URL, item.attr("href")),
      photoUrl: toAbsoluteUrl(MGSTAGE_BASE_URL, item.find("img").first().attr("src")),
    });
  }

  return roster;
};

const buildActorPhotoUrl = (name: string): string => {
  return new URL(`/mgs/img/common/actress/${encodeURIComponent(name)}.jpg`, MGSTAGE_ASSET_BASE_URL).toString();
};

const buildSearchUrl = (name: string): string => {
  const url = new URL("/search/cSearch.php", MGSTAGE_BASE_URL);
  url.searchParams.append("actor[]", `${name}_0`);
  url.searchParams.set("type", "top");
  return url.toString();
};

export class MgstageOfficialAdapter implements OfficialSiteAdapter {
  readonly key = "mgstage";

  private readonly rosterResolver = new CachedAsyncResolver<string, OfficialActressSummary[]>();

  private rosterBucket = "";

  constructor(private readonly deps: OfficialActorSourceDependencies) {
    deps.networkClient.setDomainLimit?.("www.mgstage.com", 1, 1);
    deps.networkClient.setDomainLimit?.("static.mgstage.com", 1, 1);
  }

  matchesHints(hints: ActorSourceHint[]): boolean {
    return hints.some((hint) => hint.website === Website.MGSTAGE || matchesSourceHost(hint, "mgstage.com"));
  }

  async lookup(query: OfficialLookupRequest): Promise<OfficialLookupResult | null> {
    const roster = await this.loadRoster();
    const actress = roster.find((entry) => hasMatchingName(query.queryNames, [entry.name, ...entry.aliases]));
    if (actress?.photoUrl) {
      return {
        profile: {
          name: actress.name,
          photo_url: actress.photoUrl,
        },
        sourceHints: [
          {
            website: Website.MGSTAGE,
            sourceUrl: actress.url,
          },
        ],
      };
    }

    for (const name of toUniqueNames([query.fallbackName, ...query.queryNames])) {
      const photoUrl = buildActorPhotoUrl(name);
      const probe = await this.deps.networkClient.probe(photoUrl);
      if (!probe.ok) {
        continue;
      }

      return {
        profile: {
          name,
          photo_url: photoUrl,
        },
        sourceHints: [
          {
            website: Website.MGSTAGE,
            sourceUrl: buildSearchUrl(name),
          },
        ],
      };
    }

    return null;
  }

  private async loadRoster(): Promise<OfficialActressSummary[]> {
    const bucket = createCacheBucket();
    if (bucket !== this.rosterBucket) {
      this.rosterResolver.clear();
      this.rosterBucket = bucket;
    }

    return this.rosterResolver.resolve(this.key, async () => {
      const html = await this.deps.networkClient.getText(
        new URL("/list/actress_list.php", MGSTAGE_BASE_URL).toString(),
        {
          headers: MGSTAGE_HEADERS,
        },
      );
      return parseMgstageRoster(html);
    });
  }
}

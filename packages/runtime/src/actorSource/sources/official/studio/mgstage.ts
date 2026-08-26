import { Website } from "@mdcz/shared/enums";
import { load } from "cheerio";
import {
  hasMatchingName,
  MGSTAGE_HEADERS,
  type OfficialActressSummary,
  toAbsoluteUrl,
  toNonEmptyString,
  toUniqueNames,
} from "../shared";
import type { OfficialActorSourceDependencies, OfficialLookupRequest, OfficialLookupResult } from "../types";
import { BaseStudioOfficialAdapter } from "./BaseStudioOfficialAdapter";

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

export class MgstageOfficialAdapter extends BaseStudioOfficialAdapter<OfficialActressSummary[]> {
  constructor(deps: OfficialActorSourceDependencies) {
    super(deps, {
      key: "mgstage",
      website: Website.MGSTAGE,
      hintHosts: ["mgstage.com"],
      rateLimitedHosts: ["www.mgstage.com", "static.mgstage.com"],
    });
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
    return await this.loadCachedRoster(async () => {
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

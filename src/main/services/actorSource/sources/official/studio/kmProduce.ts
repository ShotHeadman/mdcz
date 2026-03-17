import {
  hasActorProfileContent,
  parseActorBloodType,
  parseActorDate,
  parseActorMeasurements,
  parseActorMetricCm,
} from "@main/utils/actorProfile";
import { CachedAsyncResolver } from "@main/utils/CachedAsyncResolver";
import { Website } from "@shared/enums";
import type { ActorProfile } from "@shared/types";
import { load } from "cheerio";
import type { ActorSourceHint } from "../../../types";
import {
  buildFieldDescription,
  createCacheBucket,
  getOwnText,
  hasMatchingName,
  matchesSourceHost,
  OFFICIAL_HEADERS,
  type OfficialActressSummary,
  parseDefinitionList,
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

const KM_PRODUCE_BASE_URL = "https://www.km-produce.com";
const KMP_STUDIO_PATTERN = /(km\s*-?\s*produce|kmp|ケイ[・･]エム[・･]プロデュース|ケイエムプロデュース)/iu;

const parseKmRoster = (html: string): OfficialActressSummary[] => {
  const $ = load(html);
  return $(".act")
    .toArray()
    .map((element) => {
      const item = $(element);
      const nameNode = item.find("h4").first();
      const href = item
        .find("a")
        .toArray()
        .map((linkElement) => $(linkElement).attr("href"))
        .find((value) => {
          const hrefValue = toNonEmptyString(value);
          return hrefValue && !hrefValue.includes("/works/category/");
        });

      return {
        name: getOwnText(nameNode) ?? "",
        aliases: toUniqueNames([nameNode.find("aside").first().text()]),
        url: toAbsoluteUrl(KM_PRODUCE_BASE_URL, href),
        photoUrl: toAbsoluteUrl(KM_PRODUCE_BASE_URL, item.find("p.photo img").first().attr("src")),
      };
    })
    .filter((entry) => Boolean(entry.name) && Boolean(entry.url || entry.photoUrl));
};

const parseKmDetail = (html: string, fallback: OfficialActressSummary): ActorProfile | null => {
  const $ = load(html);
  const profileRoot = $("#profileWrap .profile").first();
  if (profileRoot.length === 0) {
    const fallbackProfile: ActorProfile = {
      name: fallback.name,
      aliases: fallback.aliases.length > 0 ? fallback.aliases : undefined,
      photo_url: fallback.photoUrl,
    };
    return hasActorProfileContent(fallbackProfile) ? fallbackProfile : null;
  }

  const fields = new Map(parseDefinitionList(profileRoot.find(".data dl").first()));

  const profile: ActorProfile = {
    name: toNonEmptyString(profileRoot.find(".name h1").first().text()) ?? fallback.name,
    aliases: toUniqueNames([profileRoot.find(".name p").first().text(), ...fallback.aliases]),
    birth_date: parseActorDate(fields.get("生年月日")),
    blood_type: parseActorBloodType(fields.get("血液型")),
    description: buildFieldDescription(Array.from(fields.entries())),
    height_cm: parseActorMetricCm(fields.get("身長")),
    ...parseActorMeasurements(fields.get("スリーサイズ")),
    photo_url:
      toAbsoluteUrl(KM_PRODUCE_BASE_URL, profileRoot.find(".photo img.main").first().attr("src")) ?? fallback.photoUrl,
  };

  return hasActorProfileContent(profile) ? profile : null;
};

export class KmProduceOfficialAdapter implements OfficialSiteAdapter {
  readonly key = "km_produce";

  private readonly rosterResolver = new CachedAsyncResolver<string, OfficialActressSummary[]>();

  private rosterBucket = "";

  constructor(private readonly deps: OfficialActorSourceDependencies) {
    deps.networkClient.setDomainLimit?.("www.km-produce.com", 1, 1);
  }

  matchesHints(hints: ActorSourceHint[]): boolean {
    return hints.some(
      (hint) =>
        hint.website === Website.KM_PRODUCE ||
        KMP_STUDIO_PATTERN.test(hint.studio ?? "") ||
        KMP_STUDIO_PATTERN.test(hint.publisher ?? "") ||
        matchesSourceHost(hint, "km-produce.com"),
    );
  }

  async lookup(query: OfficialLookupRequest): Promise<OfficialLookupResult | null> {
    const roster = await this.loadRoster();
    const actress = roster.find((entry) => hasMatchingName(query.queryNames, [entry.name, ...entry.aliases]));
    if (!actress) {
      return null;
    }

    let profile: ActorProfile | null = null;
    if (actress.url) {
      const html = await this.deps.networkClient.getText(actress.url, {
        headers: OFFICIAL_HEADERS,
      });
      profile = parseKmDetail(html, actress);
    }

    if (!profile && actress.photoUrl) {
      profile = {
        name: actress.name || query.fallbackName,
        aliases: actress.aliases.length > 0 ? actress.aliases : undefined,
        photo_url: actress.photoUrl,
      };
    }

    if (!profile || !hasActorProfileContent(profile)) {
      return null;
    }

    return {
      profile,
      sourceHints: [
        {
          website: Website.KM_PRODUCE,
          studio: "KMP",
          sourceUrl: actress.url,
        },
      ],
    };
  }

  private async loadRoster(): Promise<OfficialActressSummary[]> {
    const bucket = createCacheBucket();
    if (bucket !== this.rosterBucket) {
      this.rosterResolver.clear();
      this.rosterBucket = bucket;
    }

    return this.rosterResolver.resolve(this.key, async () => {
      const html = await this.deps.networkClient.getText(new URL("/girls", KM_PRODUCE_BASE_URL).toString(), {
        headers: OFFICIAL_HEADERS,
      });
      return parseKmRoster(html);
    });
  }
}

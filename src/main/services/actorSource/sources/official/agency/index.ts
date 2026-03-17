import {
  hasActorProfileContent,
  parseActorBloodType,
  parseActorDate,
  parseActorMeasurements,
  parseActorMetricCm,
} from "@main/utils/actorProfile";
import { CachedAsyncResolver } from "@main/utils/CachedAsyncResolver";
import type { ActorProfile } from "@shared/types";
import { load } from "cheerio";
import type { ActorSourceHint } from "../../../types";
import {
  buildFieldDescription,
  createCacheBucket,
  extractBackgroundImageUrl,
  extractTextWithBreaks,
  getOwnText,
  hasMatchingName,
  matchesSourceHost,
  OFFICIAL_HEADERS,
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

const TPOWERS_BASE_URL = "https://www.t-powers.co.jp";
const CMORE_BASE_URL = "https://cmore.jp";
const CMORE_OFFICIAL_BASE_URL = "https://cmore.jp/official/";
const TPOWERS_AGENCY_PATTERN = /(t\s*-?\s*powers|ティーパワーズ)/iu;
const CMORE_AGENCY_PATTERN = /(c\s*-?\s*more|シーモア)/iu;

const parseTpowersRoster = (html: string): OfficialActressSummary[] => {
  const $ = load(html);
  return $(".p-talent__list-item")
    .toArray()
    .map((element) => {
      const item = $(element);
      const link = item.find("a").first();
      return {
        name: toNonEmptyString(item.find(".p-talent__list-name").first().text()) ?? "",
        aliases: [],
        url: toAbsoluteUrl(TPOWERS_BASE_URL, link.attr("href")),
        photoUrl: toAbsoluteUrl(TPOWERS_BASE_URL, item.find(".p-talent__list-thumb img").first().attr("src")),
      };
    })
    .filter((entry) => Boolean(entry.name) && Boolean(entry.url));
};

const parseTpowersFields = (html: string): Array<[string, string | undefined]> => {
  const $ = load(html);
  const nodes = $(".p-talent-detail__spec").first().children().toArray();
  const fields: Array<[string, string | undefined]> = [];

  for (let index = 0; index < nodes.length; index += 2) {
    const label = toNonEmptyString($(nodes[index]).text());
    const value = toNonEmptyString($(nodes[index + 1]).text());
    if (!label || !value) {
      continue;
    }
    fields.push([label, value]);
  }

  return fields;
};

const parseTpowersDetail = (html: string, fallback: OfficialActressSummary): ActorProfile | null => {
  const $ = load(html);
  const fields = new Map(parseTpowersFields(html));
  const profile: ActorProfile = {
    name:
      toNonEmptyString($(".p-talent-detail__name-pc").first().text()) ??
      toNonEmptyString($(".p-talent-detail__name-sp").first().text()) ??
      fallback.name,
    aliases: toUniqueNames([$(".p-talent-detail__vis-name-item").first().text()]),
    birth_date: parseActorDate(fields.get("生年月日")),
    birth_place: toNonEmptyString(fields.get("出身地")),
    blood_type: parseActorBloodType(fields.get("血液型")),
    description: buildFieldDescription(Array.from(fields.entries())),
    height_cm: parseActorMetricCm(fields.get("身長")),
    photo_url:
      extractBackgroundImageUrl(TPOWERS_BASE_URL, $(".p-talent-detail__vis-slider-img").first().attr("style")) ??
      fallback.photoUrl,
  };

  return hasActorProfileContent(profile) ? profile : null;
};

const parseCmoreRoster = (html: string): OfficialActressSummary[] => {
  const $ = load(html);
  return $(".list-box_item")
    .toArray()
    .map((element) => {
      const item = $(element);
      const heading = item.find(".heading-lv4").first();
      return {
        name: getOwnText(heading) ?? "",
        aliases: [],
        url: toAbsoluteUrl(CMORE_OFFICIAL_BASE_URL, item.find("a.box").first().attr("href")),
        photoUrl: toAbsoluteUrl(CMORE_OFFICIAL_BASE_URL, item.find(".box_eyecatch img").first().attr("src")),
      };
    })
    .filter((entry) => Boolean(entry.name) && Boolean(entry.url));
};

const parseCmoreDetail = (html: string, fallback: OfficialActressSummary): ActorProfile | null => {
  const $ = load(html);
  const title = toNonEmptyString($("title").text());
  const name = title?.split("｜")[0] ?? fallback.name;
  const contentBlocks = $(".block-item_content");
  const fields = (() => {
    const htmlBlock = contentBlocks.first().html() ?? "";
    if (!htmlBlock) {
      return new Map<string, string>();
    }

    const fragment = load(`<div>${htmlBlock.replace(/<br\s*\/?>/giu, "\n")}</div>`);
    const lines = fragment("div")
      .text()
      .split(/\n+/u)
      .map((line) => toNonEmptyString(line.replace(/[【】]/gu, "")))
      .filter((line): line is string => Boolean(line));
    const pairs: Array<[string, string]> = [];

    for (let index = 0; index < lines.length - 1; index += 2) {
      pairs.push([lines[index], lines[index + 1]]);
    }

    return new Map(pairs);
  })();
  const size = fields.get("サイズ");
  const measurements = parseActorMeasurements(size);
  const profile: ActorProfile = {
    name,
    birth_date: parseActorDate(fields.get("生年月日")),
    description: buildFieldDescription(
      Array.from(fields.entries()),
      extractTextWithBreaks(
        (contentBlocks.length > 1 ? contentBlocks.eq(1) : contentBlocks.first()).html() ?? undefined,
      ),
    ),
    height_cm: parseActorMetricCm(size),
    bust_cm: measurements.bust_cm,
    waist_cm: measurements.waist_cm,
    hip_cm: measurements.hip_cm,
    cup_size: measurements.cup_size,
    photo_url:
      toAbsoluteUrl(CMORE_OFFICIAL_BASE_URL, $(".block-item_media-large img").first().attr("src")) ?? fallback.photoUrl,
  };

  return hasActorProfileContent(profile) ? profile : null;
};

class TpowersOfficialAdapter implements OfficialSiteAdapter {
  readonly key = "tpowers";

  private readonly rosterResolver = new CachedAsyncResolver<string, OfficialActressSummary[]>();

  private rosterBucket = "";

  constructor(private readonly deps: OfficialActorSourceDependencies) {
    deps.networkClient.setDomainLimit?.("www.t-powers.co.jp", 1, 1);
  }

  matchesHints(hints: ActorSourceHint[]): boolean {
    return hints.some(
      (hint) => TPOWERS_AGENCY_PATTERN.test(hint.agency ?? "") || matchesSourceHost(hint, "t-powers.co.jp"),
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
    const profile = parseTpowersDetail(html, actress);
    if (!profile) {
      return null;
    }

    return {
      profile,
      sourceHints: [
        {
          agency: "T-Powers",
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
      const html = await this.deps.networkClient.getText(new URL("/talent/", TPOWERS_BASE_URL).toString(), {
        headers: OFFICIAL_HEADERS,
      });
      return parseTpowersRoster(html);
    });
  }
}

class CmoreOfficialAdapter implements OfficialSiteAdapter {
  readonly key = "cmore";

  private readonly rosterResolver = new CachedAsyncResolver<string, OfficialActressSummary[]>();

  private rosterBucket = "";

  constructor(private readonly deps: OfficialActorSourceDependencies) {
    deps.networkClient.setDomainLimit?.("cmore.jp", 1, 1);
  }

  matchesHints(hints: ActorSourceHint[]): boolean {
    return hints.some((hint) => CMORE_AGENCY_PATTERN.test(hint.agency ?? "") || matchesSourceHost(hint, "cmore.jp"));
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
    const profile = parseCmoreDetail(html, actress);
    if (!profile) {
      return null;
    }

    return {
      profile,
      sourceHints: [
        {
          agency: "C-more",
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
      const html = await this.deps.networkClient.getText(new URL("/official/model.html", CMORE_BASE_URL).toString(), {
        headers: OFFICIAL_HEADERS,
      });
      return parseCmoreRoster(html);
    });
  }
}

export const createOfficialAgencyAdapters = (deps: OfficialActorSourceDependencies): OfficialSiteAdapter[] => {
  return [new TpowersOfficialAdapter(deps), new CmoreOfficialAdapter(deps)];
};

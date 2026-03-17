import { normalizeActorName } from "@main/utils/actor";
import {
  hasActorProfileContent,
  parseActorBloodType,
  parseActorDate,
  parseActorMetricCm,
} from "@main/utils/actorProfile";
import { CachedAsyncResolver } from "@main/utils/CachedAsyncResolver";
import { Website } from "@shared/enums";
import type { ActorProfile } from "@shared/types";
import type { ActorSourceHint } from "../../../types";
import {
  buildFieldDescription,
  createCacheBucket,
  formatIsoDate,
  hasMatchingName,
  matchesSourceHost,
  OFFICIAL_HEADERS,
  toNonEmptyString,
  toUniqueNames,
} from "../shared";
import type {
  OfficialActorSourceDependencies,
  OfficialLookupRequest,
  OfficialLookupResult,
  OfficialSiteAdapter,
} from "../types";

const PRESTIGE_BASE_URL = "https://www.prestige-av.com";
const PRESTIGE_STUDIO_PATTERN = /(prestige|プレステージ)/iu;

interface PrestigeMedia {
  path?: string | null;
}

interface PrestigeActressSummary {
  uuid?: string | null;
  name?: string | null;
  nameKana?: string | null;
  nameRoma?: string | null;
  media?: PrestigeMedia | null;
}

interface PrestigeActressListResponse {
  list?: PrestigeActressSummary[];
}

interface PrestigeActressDetailResponse extends PrestigeActressSummary {
  birthPlace?: string | null;
  birthday?: string | null;
  bloodType?: string | null;
  height?: string | null;
  breastSize?: string | null;
  waistSize?: string | null;
  hipSize?: string | null;
  hobby?: string | null;
  body?: string | null;
  twitterId?: string | null;
  instagramId?: string | null;
}

const buildPrestigeMediaUrl = (path: string | undefined): string | undefined => {
  const normalized = toNonEmptyString(path);
  if (!normalized) {
    return undefined;
  }

  return new URL(`/api/media/${normalized}`, PRESTIGE_BASE_URL).toString();
};

const buildPrestigeDescription = (detail: PrestigeActressDetailResponse): string | undefined => {
  return buildFieldDescription(
    [
      ["生年月日", formatIsoDate(toNonEmptyString(detail.birthday))],
      ["出身地", toNonEmptyString(detail.birthPlace)],
      ["血液型", toNonEmptyString(detail.bloodType)],
      ["身長", toNonEmptyString(detail.height)],
      ["B", toNonEmptyString(detail.breastSize)],
      ["W", toNonEmptyString(detail.waistSize)],
      ["H", toNonEmptyString(detail.hipSize)],
      ["趣味", toNonEmptyString(detail.hobby)],
      ["X", toNonEmptyString(detail.twitterId)],
      ["Instagram", toNonEmptyString(detail.instagramId)],
    ],
    detail.body ?? undefined,
  );
};

export class PrestigeOfficialAdapter implements OfficialSiteAdapter {
  readonly key = "prestige";

  private readonly rosterResolver = new CachedAsyncResolver<string, PrestigeActressSummary[]>();

  private rosterBucket = "";

  constructor(private readonly deps: OfficialActorSourceDependencies) {
    deps.networkClient.setDomainLimit?.("www.prestige-av.com", 1, 1);
  }

  matchesHints(hints: ActorSourceHint[]): boolean {
    return hints.some(
      (hint) =>
        hint.website === Website.PRESTIGE ||
        PRESTIGE_STUDIO_PATTERN.test(hint.studio ?? "") ||
        PRESTIGE_STUDIO_PATTERN.test(hint.publisher ?? "") ||
        matchesSourceHost(hint, "prestige-av.com"),
    );
  }

  async lookup(query: OfficialLookupRequest): Promise<OfficialLookupResult | null> {
    const roster = await this.loadRoster();
    const actress =
      roster.find((entry) =>
        hasMatchingName(query.queryNames, [
          entry.name ?? undefined,
          entry.nameKana ?? undefined,
          entry.nameRoma ?? undefined,
        ]),
      ) ??
      roster.find(
        (entry) => normalizeActorName(toNonEmptyString(entry.name) ?? "") === normalizeActorName(query.fallbackName),
      );
    if (!actress?.uuid) {
      return null;
    }

    const detail = await this.deps.networkClient.getJson<PrestigeActressDetailResponse>(
      new URL(`/api/actress/${actress.uuid}`, PRESTIGE_BASE_URL).toString(),
      {
        headers: OFFICIAL_HEADERS,
      },
    );
    const aliases = toUniqueNames([detail.nameKana ?? undefined, detail.nameRoma ?? undefined]);
    const profile: ActorProfile = {
      name: toNonEmptyString(detail.name) ?? toNonEmptyString(actress.name) ?? query.fallbackName,
      aliases: aliases.length > 0 ? aliases : undefined,
      birth_date: parseActorDate(toNonEmptyString(detail.birthday)),
      birth_place: toNonEmptyString(detail.birthPlace),
      blood_type: parseActorBloodType(toNonEmptyString(detail.bloodType)),
      description: buildPrestigeDescription(detail),
      height_cm: parseActorMetricCm(toNonEmptyString(detail.height)),
      bust_cm: parseActorMetricCm(toNonEmptyString(detail.breastSize)),
      waist_cm: parseActorMetricCm(toNonEmptyString(detail.waistSize)),
      hip_cm: parseActorMetricCm(toNonEmptyString(detail.hipSize)),
      photo_url: buildPrestigeMediaUrl(detail.media?.path ?? actress.media?.path ?? undefined),
    };

    return hasActorProfileContent(profile)
      ? {
          profile,
          sourceHints: [
            {
              website: Website.PRESTIGE,
              studio: "プレステージ",
            },
          ],
        }
      : null;
  }

  private async loadRoster(): Promise<PrestigeActressSummary[]> {
    const bucket = createCacheBucket();
    if (bucket !== this.rosterBucket) {
      this.rosterResolver.clear();
      this.rosterBucket = bucket;
    }

    return this.rosterResolver.resolve(this.key, async () => {
      const payload = await this.deps.networkClient.getJson<PrestigeActressListResponse>(
        new URL("/api/actress", PRESTIGE_BASE_URL).toString(),
        {
          headers: OFFICIAL_HEADERS,
        },
      );
      return payload.list ?? [];
    });
  }
}

import type { Configuration } from "@main/services/config";
import type { NetworkClient } from "@main/services/network";
import { normalizeActorName, toUniqueActorNames } from "@main/utils/actor";
import { parseActorBloodType, parseActorCupSize, parseActorDate, parseActorMetricCm } from "@main/utils/actorProfile";
import { buildUrl, getProperty, toErrorMessage } from "@main/utils/common";
import { normalizeText } from "@main/utils/normalization";
import { mergeActorSourceHints } from "../sourceHints";
import type { ActorLookupQuery, ActorSourceResult, BaseActorSource } from "../types";

const DEFAULT_AVBASE_BASE_URL = "https://www.avbase.net";

interface AvbaseActorCandidate {
  id: number;
  name?: string | null;
  ruby?: string | null;
  image_url?: string | null;
  note?: string | null;
}

interface AvbaseSearchResponse {
  actors?: AvbaseActorCandidate[];
}

interface AvbaseTalentActor {
  id: number;
  name?: string | null;
  ruby?: string | null;
  image_url?: string | null;
  note?: string | null;
  url?: string | null;
}

interface AvbaseTalentBasicInfo {
  birthday?: string | null;
  prefectures?: string | null;
  height?: string | null;
  bust?: string | null;
  cup?: string | null;
  waist?: string | null;
  hip?: string | null;
  hobby?: string | null;
  blood_type?: string | null;
}

interface AvbaseTalentSocial {
  id?: string | null;
  sns?: string | null;
}

interface AvbaseTalentMeta {
  basic_info?: AvbaseTalentBasicInfo | null;
  sns?: AvbaseTalentSocial[] | null;
  wikipedia?: string | null;
  [key: string]: unknown;
}

interface AvbaseTalentResponse {
  profile?: unknown;
  meta?: AvbaseTalentMeta | unknown;
  primary?: AvbaseTalentActor | null;
  actors?: AvbaseTalentActor[] | null;
}

export interface AvbaseActorSourceDependencies {
  networkClient: NetworkClient;
  baseUrl?: string;
}

const toNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = normalizeText(value);
  return normalized || undefined;
};

const resolveUrl = (baseUrl: string, value: string | undefined): string | undefined => {
  const normalized = toNonEmptyString(value);
  if (!normalized) {
    return undefined;
  }

  if (/^https?:\/\//iu.test(normalized)) {
    return normalized;
  }
  if (normalized.startsWith("//")) {
    return `https:${normalized}`;
  }

  return new URL(normalized, baseUrl).toString();
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const getMetaString = (meta: unknown, paths: readonly string[]): string | undefined => {
  for (const path of paths) {
    const value = toNonEmptyString(getProperty(meta, path));
    if (value) {
      return value;
    }
  }

  return undefined;
};

const getMetaSocials = (meta: unknown): AvbaseTalentSocial[] => {
  const socials = getProperty<unknown>(meta, "sns") ?? getProperty<unknown>(meta, "meta.sns");
  if (!Array.isArray(socials)) {
    return [];
  }

  return socials.filter((entry): entry is AvbaseTalentSocial => isRecord(entry));
};

const buildDescription = (profile: unknown, meta: unknown): string | undefined => {
  const sections: string[] = [];
  const profileText = toNonEmptyString(profile);
  if (profileText) {
    sections.push(profileText);
  }

  const hobby = getMetaString(meta, ["basic_info.hobby", "hobby"]);
  if (hobby) {
    sections.push(`趣味: ${hobby}`);
  }

  const socials = getMetaSocials(meta)
    .map((entry) => {
      const platform = toNonEmptyString(entry.sns);
      const account = toNonEmptyString(entry.id);
      return platform && account ? `${platform}: ${account}` : undefined;
    })
    .filter((entry): entry is string => Boolean(entry));
  if (socials.length > 0) {
    sections.push(`SNS:\n${socials.join("\n")}`);
  }

  const wikipedia = getMetaString(meta, ["wikipedia"]);
  if (wikipedia) {
    sections.push(`Wikipedia: ${wikipedia}`);
  }

  if (isRecord(meta)) {
    for (const [key, value] of Object.entries(meta)) {
      if (key === "basic_info" || key === "sns" || key === "wikipedia") {
        continue;
      }

      const normalized = toNonEmptyString(value);
      if (normalized) {
        sections.push(`${key}: ${normalized}`);
      }
    }
  }

  return sections.length > 0 ? sections.join("\n\n") : undefined;
};

const pickActorPhoto = (baseUrl: string, actors: AvbaseTalentActor[]): string | undefined => {
  for (const actor of actors) {
    const imageUrl = resolveUrl(baseUrl, toNonEmptyString(actor.image_url));
    if (imageUrl) {
      return imageUrl;
    }
  }

  return undefined;
};

const matchesCandidate = (queryName: string, candidate: AvbaseActorCandidate): boolean => {
  const normalizedQuery = normalizeActorName(queryName);
  if (!normalizedQuery) {
    return false;
  }

  return [candidate.name, candidate.ruby, candidate.note].some(
    (value) => normalizeActorName(value ?? "") === normalizedQuery,
  );
};

export class AvbaseActorSource implements BaseActorSource {
  readonly name = "avbase" as const;

  private readonly baseUrl: string;

  constructor(private readonly deps: AvbaseActorSourceDependencies) {
    this.baseUrl = deps.baseUrl?.replace(/\/+$/u, "") ?? DEFAULT_AVBASE_BASE_URL;

    if (typeof deps.networkClient.setDomainLimit === "function") {
      deps.networkClient.setDomainLimit(new URL(this.baseUrl).hostname, 1, 1);
    }
  }

  async lookup(_configuration: Configuration, query: ActorLookupQuery): Promise<ActorSourceResult> {
    try {
      for (const searchName of toUniqueActorNames([query.name, ...(query.aliases ?? [])], toNonEmptyString)) {
        const searchUrl = buildUrl(this.baseUrl, "/api/public/actors/search", {
          q: searchName,
          page: "1",
        });
        const searchResponse = await this.deps.networkClient.getJson<AvbaseSearchResponse[]>(searchUrl);
        const candidates = searchResponse.flatMap((entry) => entry.actors ?? []);
        const matched =
          candidates.find((candidate) => matchesCandidate(searchName, candidate)) ??
          (candidates.length === 1
            ? candidates.find((candidate) => toNonEmptyString(candidate.name) || toNonEmptyString(candidate.ruby))
            : undefined);

        if (!matched) {
          continue;
        }

        const detailUrl = buildUrl(this.baseUrl, "/api/public/talents", {
          actor_id: String(matched.id),
        });
        const detail = await this.deps.networkClient.getJson<AvbaseTalentResponse>(detailUrl);
        const actors = [detail.primary, ...(detail.actors ?? [])].filter((actor): actor is AvbaseTalentActor =>
          Boolean(actor),
        );
        const sourceUrl = resolveUrl(this.baseUrl, toNonEmptyString(detail.primary?.url));
        const aliases = toUniqueActorNames(
          actors.flatMap((actor) => [actor.ruby ?? undefined, actor.note ?? undefined]),
          toNonEmptyString,
        ).filter((alias) => normalizeActorName(alias) !== normalizeActorName((matched.name ?? query.name).trim()));

        return {
          source: this.name,
          success: true,
          profile: {
            name: toNonEmptyString(detail.primary?.name) ?? toNonEmptyString(matched.name) ?? query.name.trim(),
            aliases: aliases.length > 0 ? aliases : undefined,
            birth_date: parseActorDate(getMetaString(detail.meta, ["basic_info.birthday", "birthday"])),
            birth_place: getMetaString(detail.meta, ["basic_info.prefectures", "prefectures"]),
            blood_type: parseActorBloodType(getMetaString(detail.meta, ["basic_info.blood_type", "blood_type"])),
            description: buildDescription(detail.profile, detail.meta),
            height_cm: parseActorMetricCm(getMetaString(detail.meta, ["basic_info.height", "height"])),
            bust_cm: parseActorMetricCm(getMetaString(detail.meta, ["basic_info.bust", "bust"])),
            waist_cm: parseActorMetricCm(getMetaString(detail.meta, ["basic_info.waist", "waist"])),
            hip_cm: parseActorMetricCm(getMetaString(detail.meta, ["basic_info.hip", "hip"])),
            cup_size: parseActorCupSize(getMetaString(detail.meta, ["basic_info.cup", "cup"])),
            photo_url: pickActorPhoto(this.baseUrl, actors),
          },
          warnings: [],
          sourceHints: mergeActorSourceHints([
            {
              agency: getMetaString(detail.meta, ["所属事務所", "所属プロダクション", "所属", "agency"]),
              sourceUrl,
              studio: getMetaString(detail.meta, ["専属メーカー", "メーカー", "studio"]),
            },
          ]),
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
        warnings: [`Failed to load AVBase actor data: ${message}`],
      };
    }
  }
}

import { Website } from "@mdcz/shared/enums";
import type { ActorProfile, CrawlerData } from "@mdcz/shared/types";

export interface EditableActorProfile {
  name: string;
  photo_url: string;
}

export interface EditableNfoData {
  title: string;
  title_zh: string;
  number: string;
  actors: string[];
  actor_profiles: EditableActorProfile[];
  genres: string[];
  content_type: string;
  studio: string;
  director: string;
  publisher: string;
  series: string;
  plot: string;
  plot_zh: string;
  release_date: string;
  durationSeconds: string;
  rating: string;
  thumb_url: string;
  poster_url: string;
  fanart_url: string;
  thumb_source_url: string;
  poster_source_url: string;
  fanart_source_url: string;
  trailer_source_url: string;
  scene_images: string[];
  trailer_url: string;
  website: Website | "";
}

export type NfoValidationErrors = Partial<Record<keyof EditableNfoData, string>>;

export interface NfoValidationResult {
  valid: boolean;
  errors: NfoValidationErrors;
  data?: CrawlerData;
}

const WEBSITE_VALUES = new Set<string>(Object.values(Website));

const toStringValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
};

const normalizeStringArray = (values: unknown): string[] =>
  Array.isArray(values) ? values.map((value) => toStringValue(value).trim()).filter((value) => value.length > 0) : [];

const normalizeActorProfiles = (profiles: ActorProfile[] | undefined): EditableActorProfile[] =>
  (profiles ?? [])
    .map((profile) => ({
      name: toStringValue(profile.name).trim(),
      photo_url: toStringValue(profile.photo_url).trim(),
    }))
    .filter((profile) => profile.name.length > 0 || profile.photo_url.length > 0);

const optionalString = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseOptionalFiniteNumber = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const isWebsite = (value: string): value is Website => WEBSITE_VALUES.has(value);

const normalizeActorProfileKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();

export const normalizeEditableNfoData = (data: Partial<CrawlerData> | Partial<EditableNfoData>): EditableNfoData => ({
  title: toStringValue(data.title),
  title_zh: toStringValue(data.title_zh),
  number: toStringValue(data.number),
  actors: normalizeStringArray(data.actors),
  actor_profiles: normalizeActorProfiles(data.actor_profiles as ActorProfile[] | undefined),
  genres: normalizeStringArray(data.genres),
  content_type: toStringValue(data.content_type),
  studio: toStringValue(data.studio),
  director: toStringValue(data.director),
  publisher: toStringValue(data.publisher),
  series: toStringValue(data.series),
  plot: toStringValue(data.plot),
  plot_zh: toStringValue(data.plot_zh),
  release_date: toStringValue(data.release_date),
  durationSeconds: toStringValue(data.durationSeconds),
  rating: toStringValue(data.rating),
  thumb_url: toStringValue(data.thumb_url),
  poster_url: toStringValue(data.poster_url),
  fanart_url: toStringValue(data.fanart_url),
  thumb_source_url: toStringValue(data.thumb_source_url),
  poster_source_url: toStringValue(data.poster_source_url),
  fanart_source_url: toStringValue(data.fanart_source_url),
  trailer_source_url: toStringValue(data.trailer_source_url),
  scene_images: normalizeStringArray(data.scene_images),
  trailer_url: toStringValue(data.trailer_url),
  website: isWebsite(toStringValue(data.website)) ? (data.website as Website) : "",
});

export const createEmptyEditableNfoData = (): EditableNfoData =>
  normalizeEditableNfoData({
    title: "",
    number: "",
    actors: [],
    genres: [],
    scene_images: [],
    website: "",
  });

export const serializeEditableNfoData = (data: EditableNfoData): string =>
  JSON.stringify(normalizeEditableNfoData(data));

export const validateEditableNfoData = (data: EditableNfoData): NfoValidationResult => {
  const normalized = normalizeEditableNfoData(data);
  const errors: NfoValidationErrors = {};
  const title = normalized.title.trim();
  const number = normalized.number.trim();
  const website = normalized.website;
  const validWebsite = isWebsite(website) ? website : undefined;
  const durationSeconds = parseOptionalFiniteNumber(normalized.durationSeconds);
  const rating = parseOptionalFiniteNumber(normalized.rating);
  const actorProfiles = normalized.actor_profiles.filter(
    (profile) => profile.name.trim().length > 0 || profile.photo_url.trim().length > 0,
  );
  const actors = [...normalized.actors];
  const actorKeys = new Set(actors.map(normalizeActorProfileKey).filter(Boolean));

  if (!title) {
    errors.title = "标题不能为空";
  }
  if (!number) {
    errors.number = "番号不能为空";
  }
  if (!validWebsite) {
    errors.website = "请选择来源站点";
  }
  if (Number.isNaN(durationSeconds)) {
    errors.durationSeconds = "时长必须是有效数字";
  }
  if (Number.isNaN(rating)) {
    errors.rating = "评分必须是有效数字";
  }
  if (actorProfiles.some((profile) => !profile.name.trim())) {
    errors.actor_profiles = "演员资料的姓名不能为空";
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  const crawlerWebsite = validWebsite as Website;

  for (const profile of actorProfiles) {
    const profileName = profile.name.trim();
    const profileKey = normalizeActorProfileKey(profileName);
    if (profileKey && !actorKeys.has(profileKey)) {
      actors.push(profileName);
      actorKeys.add(profileKey);
    }
  }

  return {
    valid: true,
    errors,
    data: {
      title,
      title_zh: optionalString(normalized.title_zh),
      number,
      actors,
      actor_profiles:
        actorProfiles.length > 0
          ? actorProfiles.map((profile) => ({
              name: profile.name.trim(),
              photo_url: optionalString(profile.photo_url),
            }))
          : undefined,
      genres: normalized.genres,
      content_type: optionalString(normalized.content_type),
      studio: optionalString(normalized.studio),
      director: optionalString(normalized.director),
      publisher: optionalString(normalized.publisher),
      series: optionalString(normalized.series),
      plot: optionalString(normalized.plot),
      plot_zh: optionalString(normalized.plot_zh),
      release_date: optionalString(normalized.release_date),
      durationSeconds,
      rating,
      thumb_url: optionalString(normalized.thumb_url),
      poster_url: optionalString(normalized.poster_url),
      fanart_url: optionalString(normalized.fanart_url),
      thumb_source_url: optionalString(normalized.thumb_source_url),
      poster_source_url: optionalString(normalized.poster_source_url),
      fanart_source_url: optionalString(normalized.fanart_source_url),
      trailer_source_url: optionalString(normalized.trailer_source_url),
      scene_images: normalized.scene_images,
      trailer_url: optionalString(normalized.trailer_url),
      website: crawlerWebsite,
    },
  };
};

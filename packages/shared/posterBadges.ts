export const POSTER_TAG_BADGE_TYPE_OPTIONS = [
  "subtitle",
  "censored",
  "umr",
  "leak",
  "uncensored",
  "fullHd",
  "fourK",
  "eightK",
] as const;

export type PosterTagBadgeType = (typeof POSTER_TAG_BADGE_TYPE_OPTIONS)[number];

export const DEFAULT_POSTER_TAG_BADGE_TYPES: readonly PosterTagBadgeType[] = [
  "subtitle",
  "umr",
  "leak",
  "uncensored",
  "fourK",
  "eightK",
];

export const POSTER_TAG_BADGE_POSITION_OPTIONS = ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const;

export type PosterTagBadgePosition = (typeof POSTER_TAG_BADGE_POSITION_OPTIONS)[number];

export const POSTER_TAG_BADGE_WIDTH_RATIO = 0.24;
export const POSTER_TAG_BADGE_MAX_WIDTH_RATIO = 0.34;
export const POSTER_TAG_BADGE_MIN_WIDTH = 108;
export const POSTER_TAG_BADGE_MAX_WIDTH = 184;
export const POSTER_TAG_BADGE_ASPECT_WIDTH = 120;
export const POSTER_TAG_BADGE_ASPECT_HEIGHT = 60;
export const POSTER_TAG_BADGE_ASPECT_RATIO = POSTER_TAG_BADGE_ASPECT_WIDTH / POSTER_TAG_BADGE_ASPECT_HEIGHT;

export const POSTER_TAG_BADGE_TYPE_LABELS: Record<PosterTagBadgeType, string> = {
  subtitle: "中字",
  censored: "有码",
  umr: "破解",
  leak: "流出",
  uncensored: "无码",
  fullHd: "1080P",
  fourK: "4K",
  eightK: "8K",
};

export const POSTER_TAG_BADGE_IMAGE_EXTENSIONS = ["png", "webp", "jpg", "jpeg"] as const;

export type PosterTagBadgeImageExtension = (typeof POSTER_TAG_BADGE_IMAGE_EXTENSIONS)[number];

export const POSTER_TAG_BADGE_IMAGE_FILENAMES: Record<PosterTagBadgeType, readonly string[]> = {
  subtitle: ["subtitle", "中字"],
  censored: ["censored", "有码"],
  umr: ["umr", "破解"],
  leak: ["leak", "流出"],
  uncensored: ["uncensored", "无码"],
  fullHd: ["fullHd", "1080P"],
  fourK: ["fourK", "4K"],
  eightK: ["eightK", "8K"],
};

export const POSTER_TAG_BADGE_POSITION_LABELS: Record<PosterTagBadgePosition, string> = {
  topLeft: "左上",
  topRight: "右上",
  bottomLeft: "左下",
  bottomRight: "右下",
};

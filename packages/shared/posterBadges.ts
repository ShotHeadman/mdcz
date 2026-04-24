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

export const POSTER_TAG_BADGE_POSITION_LABELS: Record<PosterTagBadgePosition, string> = {
  topLeft: "左上",
  topRight: "右上",
  bottomLeft: "左下",
  bottomRight: "右下",
};

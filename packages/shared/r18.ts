export const R18_METADATA_LANGUAGE_OPTIONS = ["ja", "en"] as const;

export type R18MetadataLanguage = (typeof R18_METADATA_LANGUAGE_OPTIONS)[number];

export const DEFAULT_R18_METADATA_LANGUAGE: R18MetadataLanguage = "ja";

import type { UiLocale } from "@mdcz/shared/enums";
import type { ActorProfile } from "@mdcz/shared/types";

const MANAGED_TAG_PREFIX = "mdcz:";
const MANAGED_TAGLINE_PREFIX = "MDCz: ";
const BIO_LABELS: Record<
  UiLocale,
  { profile: string; bloodType: string; height: string; measurements: string; cup: string; aliases: string }
> = {
  "zh-CN": {
    profile: "基本资料",
    bloodType: "血型：{}型",
    height: "身高：{}cm",
    measurements: "三围：{}",
    cup: "罩杯：{}杯",
    aliases: "别名：",
  },
  "en-US": {
    profile: "Profile",
    bloodType: "Blood type: {}",
    height: "Height: {} cm",
    measurements: "Measurements: {}",
    cup: "Cup: {}",
    aliases: "Also known as: ",
  },
};
const ALL_BIO_LABELS = Object.values(BIO_LABELS);
// A bio MDCz wrote in another language, or with the birth lines older versions wrote, is still MDCz's own block.
const MANAGED_PROFILE_LINE_PREFIXES = [
  "生日：",
  "出生地：",
  ...ALL_BIO_LABELS.flatMap((labels) =>
    [labels.bloodType, labels.height, labels.measurements, labels.cup].map((label) =>
      label.slice(0, label.indexOf("{}")),
    ),
  ),
];

const fillLabel = (label: string, value: string | number): string => label.replace("{}", String(value));

const normalizeText = (value: string | undefined): string => value?.trim().replace(/\s+/gu, " ") ?? "";

const normalizeActorName = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

const toUniqueActorNames = (values: string[]): string[] => {
  const seen = new Set<string>();
  const outputs: string[] = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    const key = normalizeActorName(normalized);
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    outputs.push(normalized);
  }
  return outputs;
};

const isActorManagedTag = (value: string): boolean => value.startsWith(MANAGED_TAG_PREFIX);

const isActorManagedTagline = (value: string): boolean => value.startsWith(MANAGED_TAGLINE_PREFIX);

const normalizeOverview = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

  return normalized || undefined;
};

const buildAliasesLine = (
  profile: Pick<ActorProfile, "name" | "aliases">,
  labels: (typeof BIO_LABELS)[UiLocale],
): string | undefined => {
  const aliases = toUniqueActorNames(profile.aliases ?? []).filter(
    (alias) => normalizeActorName(alias) !== normalizeActorName(profile.name),
  );

  return aliases.length > 0 ? `${labels.aliases}${aliases.join(" / ")}` : undefined;
};

// Birth date and birthplace go to the server's own fields, which Jellyfin and Emby show as born and birthplace.
const buildProfileSummaryBlock = (
  profile: Pick<ActorProfile, "blood_type" | "height_cm" | "bust_cm" | "waist_cm" | "hip_cm" | "cup_size">,
  labels: (typeof BIO_LABELS)[UiLocale],
): string | undefined => {
  const measurements = [
    profile.bust_cm !== undefined ? `B${profile.bust_cm}` : undefined,
    profile.waist_cm !== undefined ? `W${profile.waist_cm}` : undefined,
    profile.hip_cm !== undefined ? `H${profile.hip_cm}` : undefined,
  ].filter((entry): entry is string => Boolean(entry));
  const lines = [
    profile.blood_type ? fillLabel(labels.bloodType, profile.blood_type) : undefined,
    profile.height_cm !== undefined ? fillLabel(labels.height, profile.height_cm) : undefined,
    measurements.length > 0 ? fillLabel(labels.measurements, measurements.join(" ")) : undefined,
    profile.cup_size ? fillLabel(labels.cup, profile.cup_size) : undefined,
  ].filter((entry): entry is string => Boolean(entry));

  return lines.length > 0 ? `${labels.profile}\n${lines.join("\n")}` : undefined;
};

const isManagedProfileLine = (line: string): boolean =>
  MANAGED_PROFILE_LINE_PREFIXES.some((prefix) => line.startsWith(prefix));

const stripManagedProfileBlock = (overview: string | undefined): string | undefined => {
  if (!overview) {
    return undefined;
  }

  const lines = overview.split("\n");
  let cursor = 0;
  while (cursor < lines.length && lines[cursor] === "") {
    cursor += 1;
  }

  if (!ALL_BIO_LABELS.some((labels) => labels.profile === lines[cursor])) {
    return overview;
  }

  cursor += 1;
  let detailCount = 0;
  while (cursor < lines.length && lines[cursor] !== "") {
    if (!isManagedProfileLine(lines[cursor] ?? "")) {
      return overview;
    }
    detailCount += 1;
    cursor += 1;
  }

  if (detailCount === 0) {
    return overview;
  }

  while (cursor < lines.length && lines[cursor] === "") {
    cursor += 1;
  }

  const strippedOverview = lines.slice(cursor).join("\n").trim();
  return strippedOverview || undefined;
};

const stripManagedPersonOverview = (overview: string | undefined): string | undefined => {
  const normalizedOverview = stripManagedProfileBlock(normalizeOverview(overview));
  if (!normalizedOverview) {
    return undefined;
  }

  const lines = normalizedOverview.split("\n");
  let endIndex = lines.length;
  while (endIndex > 0 && lines[endIndex - 1] === "") {
    endIndex--;
  }

  const lastLine = lines[endIndex - 1] ?? "";
  if (endIndex === 0 || !ALL_BIO_LABELS.some((labels) => lastLine.startsWith(labels.aliases))) {
    return normalizedOverview;
  }

  endIndex--;
  while (endIndex > 0 && lines[endIndex - 1] === "") {
    endIndex--;
  }

  const strippedOverview = lines.slice(0, endIndex).join("\n").trim();
  return strippedOverview || undefined;
};

const buildPersonOverview = (
  overview: string | undefined,
  profile: ActorProfile,
  locale: UiLocale,
): string | undefined => {
  const normalizedOverview = normalizeOverview(overview);
  const profileSummary = buildProfileSummaryBlock(profile, BIO_LABELS[locale]);
  const aliasesLine = buildAliasesLine(profile, BIO_LABELS[locale]);

  const sections = [profileSummary, normalizedOverview, aliasesLine].filter((entry): entry is string => Boolean(entry));
  return sections.length > 0 ? sections.join("\n\n") : undefined;
};

export type PersonSyncMode = "all" | "missing";
export type PersonSyncField =
  | "overview"
  | "tags"
  | "taglines"
  | "premiereDate"
  | "productionLocations"
  | "productionYear";

export interface ExistingPersonSyncState {
  overview?: string;
  tags?: string[];
  taglines?: string[];
  premiereDate?: string;
  productionYear?: number;
  productionLocations?: string[];
}

export interface PlannedPersonSyncState {
  shouldUpdate: boolean;
  updatedFields: PersonSyncField[];
  overview?: string;
  tags: string[];
  taglines: string[];
  premiereDate?: string;
  productionYear?: number;
  productionLocations?: string[];
}

const toTrimmedString = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

const toStringArray = (value: string[] | undefined): string[] => {
  return value?.map((entry) => entry.trim()).filter((entry) => entry.length > 0) ?? [];
};

const toFiniteNumber = (value: number | undefined): number | undefined => {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const extractIsoDate = (value: string | undefined): string | undefined => {
  const normalized = toTrimmedString(value);
  if (!normalized) {
    return undefined;
  }

  const matched = normalized.match(/(\d{4}-\d{2}-\d{2})/u);
  return matched?.[1];
};

const toPremiereDate = (birthDate: string | undefined): string | undefined => {
  return birthDate ? `${birthDate}T00:00:00.000Z` : undefined;
};

const toProductionYear = (birthDate: string | undefined): number | undefined => {
  if (!birthDate) {
    return undefined;
  }

  const year = Number.parseInt(birthDate.slice(0, 4), 10);
  return Number.isFinite(year) ? year : undefined;
};

const normalizeExistingPersonSyncState = (existing: ExistingPersonSyncState): ExistingPersonSyncState => ({
  overview: toTrimmedString(existing.overview),
  tags: toStringArray(existing.tags),
  taglines: toStringArray(existing.taglines),
  premiereDate: toTrimmedString(existing.premiereDate),
  productionYear: toFiniteNumber(existing.productionYear),
  productionLocations: toStringArray(existing.productionLocations),
});

const haveSameTagMembers = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size !== rightSet.size) {
    return false;
  }

  for (const entry of leftSet) {
    if (!rightSet.has(entry)) {
      return false;
    }
  }

  return true;
};

const haveSameArrayOrder = (left: string[], right: string[]): boolean => {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
};

const resolveOverview = (
  currentOverview: string | undefined,
  sourceProfile: ActorProfile,
  mode: PersonSyncMode,
  locale: UiLocale,
): string | undefined => {
  const currentOverviewBase = stripManagedPersonOverview(currentOverview) ?? currentOverview;
  const preferredOverview =
    mode === "all"
      ? (sourceProfile.description ?? currentOverviewBase)
      : (currentOverviewBase ?? sourceProfile.description);

  return buildPersonOverview(preferredOverview, sourceProfile, locale) ?? currentOverviewBase ?? currentOverview;
};

const resolvePremiereDate = (
  currentPremiereDate: string | undefined,
  sourceBirthDate: string | undefined,
  mode: PersonSyncMode,
): string | undefined => {
  const currentBirthDate = extractIsoDate(currentPremiereDate);
  const targetPremiereDate = toPremiereDate(sourceBirthDate);

  if (mode === "missing") {
    return currentPremiereDate ?? targetPremiereDate;
  }

  if (!sourceBirthDate) {
    return currentPremiereDate;
  }

  if (currentBirthDate === sourceBirthDate && currentPremiereDate) {
    return currentPremiereDate;
  }

  return targetPremiereDate;
};

const resolveProductionYear = (
  currentProductionYear: number | undefined,
  sourceBirthDate: string | undefined,
  mode: PersonSyncMode,
): number | undefined => {
  const targetProductionYear = toProductionYear(sourceBirthDate);
  return mode === "all"
    ? (targetProductionYear ?? currentProductionYear)
    : (currentProductionYear ?? targetProductionYear);
};

const resolveProductionLocations = (
  currentProductionLocations: string[],
  sourceBirthPlace: string | undefined,
  mode: PersonSyncMode,
): string[] => {
  if (!sourceBirthPlace) {
    return currentProductionLocations;
  }

  if (mode === "missing") {
    return currentProductionLocations.length > 0 ? currentProductionLocations : [sourceBirthPlace];
  }

  return [sourceBirthPlace, ...currentProductionLocations.filter((location) => location !== sourceBirthPlace)];
};

export const planPersonSync = (
  sourceProfile: ActorProfile,
  existing: ExistingPersonSyncState,
  mode: PersonSyncMode,
  locale: UiLocale,
): PlannedPersonSyncState => {
  const normalizedExisting = normalizeExistingPersonSyncState(existing);
  const currentOverview = normalizedExisting.overview;
  const currentTags = normalizedExisting.tags ?? [];
  const currentTaglines = normalizedExisting.taglines ?? [];
  const currentPremiereDate = normalizedExisting.premiereDate;
  const currentProductionYear = normalizedExisting.productionYear;
  const currentProductionLocations = normalizedExisting.productionLocations ?? [];

  const retainedTags = currentTags.filter((tag) => !isActorManagedTag(tag));
  const retainedTaglines = currentTaglines.filter((tagline) => !isActorManagedTagline(tagline));

  const overview = resolveOverview(currentOverview, sourceProfile, mode, locale);
  const tags = retainedTags;
  const taglines = retainedTaglines;

  const sourceBirthDate = extractIsoDate(sourceProfile.birth_date);
  const sourceBirthPlace = toTrimmedString(sourceProfile.birth_place);
  const premiereDate = resolvePremiereDate(currentPremiereDate, sourceBirthDate, mode);
  const productionYear = resolveProductionYear(currentProductionYear, sourceBirthDate, mode);
  const productionLocations = resolveProductionLocations(currentProductionLocations, sourceBirthPlace, mode);

  const updatedFields: PersonSyncField[] = [];
  if (overview !== currentOverview) {
    updatedFields.push("overview");
  }
  if (!haveSameTagMembers(tags, currentTags)) {
    updatedFields.push("tags");
  }
  if (!haveSameArrayOrder(taglines, currentTaglines)) {
    updatedFields.push("taglines");
  }
  if (premiereDate !== currentPremiereDate) {
    updatedFields.push("premiereDate");
  }
  if (productionYear !== currentProductionYear) {
    updatedFields.push("productionYear");
  }
  if (!haveSameArrayOrder(productionLocations, currentProductionLocations)) {
    updatedFields.push("productionLocations");
  }

  return {
    shouldUpdate: updatedFields.length > 0,
    updatedFields,
    overview,
    tags,
    taglines,
    premiereDate,
    productionYear,
    productionLocations: productionLocations.length > 0 ? productionLocations : undefined,
  };
};

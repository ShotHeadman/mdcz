import { isActorManagedTag, isActorManagedTagline } from "@main/utils/actorProfile";
import { buildPersonOverview, stripManagedPersonOverview } from "@main/utils/personMetadata";
import type { ActorProfile } from "@shared/types";

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

export const normalizeExistingPersonSyncState = (existing: ExistingPersonSyncState): ExistingPersonSyncState => ({
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
): string | undefined => {
  const currentOverviewBase = stripManagedPersonOverview(currentOverview) ?? currentOverview;
  const preferredOverview =
    mode === "all"
      ? (sourceProfile.description ?? currentOverviewBase)
      : (currentOverviewBase ?? sourceProfile.description);

  return buildPersonOverview(preferredOverview, sourceProfile) ?? currentOverviewBase ?? currentOverview;
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

export const hasManagedActorTags = (tags: string[] | undefined): boolean => {
  return toStringArray(tags).some(isActorManagedTag);
};

export const hasManagedActorSummary = (taglines: string[] | undefined): boolean => {
  return toStringArray(taglines).some(isActorManagedTagline);
};

export const planPersonSync = (
  sourceProfile: ActorProfile,
  existing: ExistingPersonSyncState,
  mode: PersonSyncMode,
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

  const overview = resolveOverview(currentOverview, sourceProfile, mode);
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

export const hasMissingActorInfo = (
  existing: ExistingPersonSyncState,
  sourceProfile: Partial<ActorProfile> = {},
): boolean => {
  const normalizedExisting = normalizeExistingPersonSyncState(existing);

  if (!normalizedExisting.overview) {
    return true;
  }

  if (hasManagedActorTags(normalizedExisting.tags) || hasManagedActorSummary(normalizedExisting.taglines)) {
    return true;
  }

  return planPersonSync({ name: "", ...sourceProfile }, normalizedExisting, "missing").shouldUpdate;
};

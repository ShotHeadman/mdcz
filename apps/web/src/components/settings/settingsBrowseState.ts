import { resolveSettingsDeepLink, type SettingsDeepLinkSectionId } from "./settingsDeepLink";
import { getVisibleEntries, parseSettingsQuery } from "./settingsFilter";
import { FIELD_REGISTRY, type FieldAnchor, type FieldEntry } from "./settingsRegistry";

export interface SettingsBrowseStateInput {
  query: string;
  showAdvanced: boolean;
  modifiedKeys: ReadonlySet<string>;
  deepLinkSettingKey?: string | null;
}

export interface SettingsBrowseState {
  parsedQuery: ReturnType<typeof parseSettingsQuery>;
  visibleEntries: FieldEntry[];
  visibleKeySet: ReadonlySet<string>;
  visiblePublicAnchorSet: ReadonlySet<FieldAnchor>;
  visibleAdvancedAnchorSet: ReadonlySet<FieldAnchor>;
  hasActiveFilters: boolean;
  isAdvancedVisible: boolean;
  hasVisibleAdvancedEntries: boolean;
  targetFieldKey: string | null;
  targetSectionId: SettingsDeepLinkSectionId | null;
}

export function buildSettingsBrowseState({
  query,
  showAdvanced,
  modifiedKeys,
  deepLinkSettingKey = null,
}: SettingsBrowseStateInput): SettingsBrowseState {
  const parsedQuery = parseSettingsQuery(query);
  const deepLink = resolveSettingsDeepLink(deepLinkSettingKey);
  const visibleEntries = getVisibleEntries(FIELD_REGISTRY, {
    parsedQuery,
    showAdvanced,
    modifiedKeys,
  });
  const visibleKeySet = new Set(visibleEntries.map((entry) => entry.key));
  const visiblePublicAnchorSet = new Set(
    visibleEntries.filter((entry) => entry.visibility === "public").map((entry) => entry.anchor),
  );
  const visibleAdvancedAnchorSet = new Set(
    visibleEntries.filter((entry) => entry.visibility === "advanced").map((entry) => entry.anchor),
  );
  const hasVisibleAdvancedEntries = visibleEntries.some((entry) => entry.visibility === "advanced");

  return {
    parsedQuery,
    visibleEntries,
    visibleKeySet,
    visiblePublicAnchorSet,
    visibleAdvancedAnchorSet,
    hasActiveFilters: parsedQuery.hasFilters,
    isAdvancedVisible: showAdvanced,
    hasVisibleAdvancedEntries,
    targetFieldKey: deepLink.fieldKey,
    targetSectionId: deepLink.sectionId,
  };
}

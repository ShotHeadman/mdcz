import { FIELD_REGISTRY_BY_KEY, type FieldAnchor } from "./settingsRegistry";

export type SettingsDeepLinkSectionId = FieldAnchor | "advancedSettings";

export interface ResolvedSettingsDeepLink {
  fieldKey: string | null;
  sectionId: SettingsDeepLinkSectionId | null;
}

export function resolveSettingsDeepLink(settingKey?: string | null): ResolvedSettingsDeepLink {
  const normalizedSettingKey = settingKey?.trim() || null;
  if (!normalizedSettingKey) {
    return {
      fieldKey: null,
      sectionId: null,
    };
  }

  const entry = FIELD_REGISTRY_BY_KEY[normalizedSettingKey];
  if (!entry) {
    return {
      fieldKey: null,
      sectionId: null,
    };
  }

  if (entry.surface !== "settings" || entry.visibility === "advanced") {
    return {
      fieldKey: null,
      sectionId: null,
    };
  }

  return {
    fieldKey: entry.key,
    sectionId: entry.anchor,
  };
}

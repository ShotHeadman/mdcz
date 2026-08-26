import { useOptionalSettingsSearch } from "./SettingsSearchContext";
import { shouldRenderFieldInSectionMode, useSettingsSectionMode } from "./SettingsSectionModeContext";

export function useHasRenderableFields(fieldNames: readonly string[]): boolean {
  const search = useOptionalSettingsSearch();
  const sectionMode = useSettingsSectionMode();

  return fieldNames.some((name) => {
    if (!shouldRenderFieldInSectionMode(name, sectionMode)) return false;
    return search ? search.isFieldVisible(name) : true;
  });
}

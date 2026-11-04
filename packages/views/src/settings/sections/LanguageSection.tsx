import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mdcz/ui";
import { LOCALE_NAMES, LOCALES, type Locale, useLocaleStore, useT } from "../../i18n";
import { SettingRow } from "../SettingRow";

export function LanguageSection() {
  const t = useT();
  const { locale, setLocale } = useLocaleStore();

  return (
    <SettingRow
      label={t.settings.language.label}
      description={t.settings.language.description}
      htmlFor="settings-language"
      control={
        <Select value={locale} onValueChange={(next) => setLocale(next as Locale)}>
          <SelectTrigger id="settings-language" className="h-8 w-[200px] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOCALES.map((value) => (
              <SelectItem key={value} value={value}>
                {LOCALE_NAMES[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );
}

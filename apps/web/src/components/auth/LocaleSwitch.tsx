import { Button } from "@mdcz/ui";
import { LOCALE_NAMES, useLocaleStore, useT } from "@mdcz/views/i18n";
import { Languages } from "lucide-react";

/** Signed-out pages have no settings page, so this is where someone in the wrong language switches it. */
export const LocaleSwitch = () => {
  const t = useT();
  const { locale, setLocale } = useLocaleStore();
  const other = locale === "zh-CN" ? "en-US" : "zh-CN";
  return (
    <Button
      variant="ghost"
      size="sm"
      className="absolute top-4 right-4 text-muted-foreground"
      aria-label={t.shell.switchLanguage}
      onClick={() => setLocale(other)}
    >
      <Languages />
      {LOCALE_NAMES[other]}
    </Button>
  );
};

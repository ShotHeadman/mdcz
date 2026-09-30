import { create } from "zustand";
import { en, type Messages } from "./en";
import { zh } from "./zh";

export type { Messages };
export type Locale = "en-US" | "zh-CN";

export const LOCALES: Locale[] = ["en-US", "zh-CN"];

const STORAGE_KEY = "mdcz-locale";
const DICTIONARIES: Record<Locale, Messages> = { "en-US": en, "zh-CN": zh };

const detectLocale = (): Locale => {
  const stored = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
  if (stored === "en-US" || stored === "zh-CN") return stored;
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
};

const applyDocumentLocale = (locale: Locale) => {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
};

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>((set) => {
  const locale = detectLocale();
  applyDocumentLocale(locale);
  return {
    locale,
    setLocale: (next) => {
      localStorage.setItem(STORAGE_KEY, next);
      applyDocumentLocale(next);
      set({ locale: next });
    },
  };
});

export const useT = (): Messages => DICTIONARIES[useLocaleStore((state) => state.locale)];

/** Non-reactive access for callbacks, stores, and adapters outside React render. */
export const getT = (): Messages => DICTIONARIES[useLocaleStore.getState().locale];

/** Every translation of a message, used where search must match both languages. */
export const allTranslations = <T>(select: (messages: Messages) => T): T[] =>
  LOCALES.map((locale) => select(DICTIONARIES[locale]));

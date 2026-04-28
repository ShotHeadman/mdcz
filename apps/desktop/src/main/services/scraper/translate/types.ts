import type { TranslationTarget } from "@mdcz/shared/enums";

export type LanguageTarget = "zh_cn" | "zh_tw";

export const toTarget = (value: TranslationTarget): LanguageTarget => {
  if (value === "zh-TW") {
    return "zh_tw";
  }
  return "zh_cn";
};

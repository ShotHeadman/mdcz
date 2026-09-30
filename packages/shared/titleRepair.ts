import type { Configuration } from "./config";
import { BUILTIN_TITLE_REPAIR_RULES } from "./titleRepairDefaults";

export interface TitleRepairPreview {
  originalTitle: string;
  repairedTitle: string;
  matchedRules: string[];
  applied: boolean;
  reason: "disabled" | "no_match" | "repaired";
}

type TitleRepairConfiguration = Configuration["titleRepair"];

const MASK_CHARS = new Set(["●", "〇", "○", "*", "＊", "×", "■"]);

function buildRuleRegex(source: string): RegExp {
  let pattern = "";
  for (const char of source) {
    if (MASK_CHARS.has(char)) {
      pattern += "[●〇○*＊×■]";
    } else {
      pattern += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(pattern, "gu");
}

export const previewTitleRepair = (title: string, configuration: TitleRepairConfiguration): TitleRepairPreview => {
  if (!configuration.enabled) {
    return { originalTitle: title, repairedTitle: title, matchedRules: [], applied: false, reason: "disabled" };
  }

  let repairedTitle = title;
  const matchedRules: string[] = [];
  for (const rule of BUILTIN_TITLE_REPAIR_RULES) {
    if (!rule.replacement) {
      continue;
    }
    const regex = buildRuleRegex(rule.source);
    const nextTitle = repairedTitle.replace(regex, rule.replacement);
    if (nextTitle !== repairedTitle) {
      repairedTitle = nextTitle;
      matchedRules.push(rule.source);
    }
  }

  if (matchedRules.length === 0 || !repairedTitle.trim()) {
    return { originalTitle: title, repairedTitle: title, matchedRules, applied: false, reason: "no_match" };
  }

  return { originalTitle: title, repairedTitle, matchedRules, applied: true, reason: "repaired" };
};

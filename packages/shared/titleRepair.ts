import type { Configuration } from "./config";

export interface TitleRepairPreview {
  originalTitle: string;
  repairedTitle: string;
  matchedRules: string[];
  applied: boolean;
  reason: "disabled" | "no_match" | "repaired";
}

type TitleRepairConfiguration = Configuration["titleRepair"];

export const previewTitleRepair = (title: string, configuration: TitleRepairConfiguration): TitleRepairPreview => {
  if (!configuration.enabled) {
    return { originalTitle: title, repairedTitle: title, matchedRules: [], applied: false, reason: "disabled" };
  }

  let repairedTitle = title;
  const matchedRules: string[] = [];
  for (const rule of configuration.rules) {
    if (!repairedTitle.includes(rule.source)) {
      continue;
    }
    repairedTitle = repairedTitle.replaceAll(rule.source, rule.replacement);
    matchedRules.push(rule.source);
  }

  if (matchedRules.length === 0 || !repairedTitle.trim()) {
    return { originalTitle: title, repairedTitle: title, matchedRules, applied: false, reason: "no_match" };
  }

  return { originalTitle: title, repairedTitle, matchedRules, applied: true, reason: "repaired" };
};

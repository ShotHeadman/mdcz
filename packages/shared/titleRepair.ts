import type { Configuration } from "./config";
import { BUILTIN_TITLE_REPAIR_RULES } from "./titleRepairDefaults";

export interface TitleRepairPreview {
  originalTitle: string;
  repairedTitle: string;
  matchedRules: string[];
  applied: boolean;
  reason: "disabled" | "no_match" | "repaired";
}

type TitleRepairConfiguration = Pick<Configuration["titleRepair"], "enabled">;

const MASK_CHARS = new Set(["●", "〇", "○", "*", "＊", "×", "■"]);

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

function buildRuleRegex(source: string): RegExp {
  let pattern = "";
  for (const char of source) {
    pattern += MASK_CHARS.has(char) ? "[●〇○*＊×■]" : escapeRegExp(char);
  }
  return new RegExp(pattern, "gu");
}

/** Removes actor names that sites append to a title, e.g. "タイトル 三上悠亜" or "タイトル（A、B）". */
export const stripTrailingActorNames = (title: string, actors: readonly string[]): string => {
  const actorPattern = actors
    .map((actor) => actor.trim())
    .filter((actor) => actor.length > 0)
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join("|");
  if (!actorPattern) return title;

  const actorList = `(?:${actorPattern})(?:\\s*[、,/&＆]\\s*(?:${actorPattern}))*`;
  const stripped = title
    .replace(new RegExp(`\\s*[（(]\\s*${actorList}\\s*[）)]\\s*$`, "u"), "")
    .replace(new RegExp(`\\s+${actorList}\\s*$`, "u"), "")
    .trim();
  return stripped || title;
};

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

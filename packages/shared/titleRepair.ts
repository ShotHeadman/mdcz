import { BUILTIN_TITLE_REPAIR_RULES } from "./titleRepairDefaults";

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

const REPAIR_RULES = BUILTIN_TITLE_REPAIR_RULES.map(({ source, replacement }) => ({
  replacement,
  regex: buildRuleRegex(source),
  masked: [...source].some((char) => MASK_CHARS.has(char)),
}));
// Plots only get mask rules: euphemism rules would rewrite ordinary words inside sentences (閉じ込められた → 監禁られた).
const MASKED_REPAIR_RULES = REPAIR_RULES.filter((rule) => rule.masked);

const applyRules = (text: string, rules: typeof REPAIR_RULES): string =>
  rules.reduce((repaired, rule) => repaired.replace(rule.regex, rule.replacement), text);

export const repairTitle = (title: string): string => applyRules(title, REPAIR_RULES);

export const repairMaskedWords = (text: string): string => applyRules(text, MASKED_REPAIR_RULES);

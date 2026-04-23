import { type FieldAnchor, type FieldEntry, SECTION_FILTER_ALIASES, SECTION_LABELS } from "./settingsRegistry";

export interface ParsedSettingsQuery {
  raw: string;
  textTerms: string[];
  groupTerms: string[];
  modified: boolean;
  hasFilters: boolean;
}

export interface SettingsFilterState {
  parsedQuery: ParsedSettingsQuery;
  showAdvanced: boolean;
  modifiedKeys: ReadonlySet<string>;
}

export interface SettingsSuggestion {
  id: string;
  kind: "token" | "group";
  label: string;
  insertValue: string;
  description?: string;
}

const TOKEN_MODIFIED = "@modified";
const TOKEN_GROUP = "@group:";

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function tokenize(query: string): string[] {
  return query.trim().split(/\s+/u).filter(Boolean);
}

function entrySearchText(entry: FieldEntry): string {
  return normalize([entry.label, entry.description].join(" "));
}

function matchesGroup(anchor: FieldAnchor, term: string): boolean {
  const normalizedTerm = normalize(term);
  if (!normalizedTerm) {
    return true;
  }

  const sectionLabel = normalize(SECTION_LABELS[anchor]);
  const candidates = [anchor.toLowerCase(), sectionLabel, ...SECTION_FILTER_ALIASES[anchor].map(normalize)];
  return candidates.some((candidate) => candidate.includes(normalizedTerm));
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }

  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function parseSettingsQuery(query: string): ParsedSettingsQuery {
  const tokens = tokenize(query);
  const textTerms: string[] = [];
  const groupTerms: string[] = [];
  let modified = false;

  for (const token of tokens) {
    const normalizedToken = normalize(token);
    if (!normalizedToken) {
      continue;
    }

    if (normalizedToken === TOKEN_MODIFIED) {
      modified = true;
      continue;
    }

    if (normalizedToken.startsWith(TOKEN_GROUP)) {
      const value = normalizedToken.slice(TOKEN_GROUP.length);
      if (value) {
        groupTerms.push(value);
      }
      continue;
    }

    textTerms.push(normalizedToken);
  }

  return {
    raw: query,
    textTerms,
    groupTerms,
    modified,
    hasFilters: textTerms.length > 0 || groupTerms.length > 0 || modified,
  };
}

export function isFieldVisible(entry: FieldEntry, state: SettingsFilterState): boolean {
  const { parsedQuery, showAdvanced, modifiedKeys } = state;
  const isModified = modifiedKeys.has(entry.key);

  if (entry.surface !== "settings" || entry.visibility === "hidden") {
    return false;
  }

  if (entry.visibility === "advanced" && !showAdvanced) {
    return false;
  }

  if (parsedQuery.modified && !isModified) {
    return false;
  }

  if (parsedQuery.groupTerms.length > 0 && !parsedQuery.groupTerms.every((term) => matchesGroup(entry.anchor, term))) {
    return false;
  }

  if (parsedQuery.textTerms.length > 0) {
    const haystack = entrySearchText(entry);
    if (!parsedQuery.textTerms.every((term) => haystack.includes(term))) {
      return false;
    }
  }

  return true;
}

export function getVisibleEntries(entries: FieldEntry[], state: SettingsFilterState): FieldEntry[] {
  return entries.filter((entry) => isFieldVisible(entry, state));
}

export function replaceLastToken(query: string, replacement: string): string {
  const trimmedEnd = query.replace(/\s+$/u, "");
  if (!trimmedEnd) {
    return `${replacement} `;
  }

  const tokenStart = trimmedEnd.lastIndexOf(" ");
  const prefix = tokenStart === -1 ? "" : `${trimmedEnd.slice(0, tokenStart + 1)}`;
  return `${prefix}${replacement} `;
}

function getActiveToken(query: string): string {
  if (!query || /\s$/u.test(query)) {
    return "";
  }

  const tokens = query.split(/\s+/u);
  return tokens.at(-1) ?? "";
}

function buildGroupSuggestions(prefix: string): SettingsSuggestion[] {
  return Object.entries(SECTION_LABELS)
    .filter(
      ([anchor, label]) => matchesGroup(anchor as FieldAnchor, prefix) || normalize(label).includes(normalize(prefix)),
    )
    .map(([anchor, label]) => ({
      id: `group:${anchor}`,
      kind: "group" as const,
      label: `按分组筛选: ${label}`,
      insertValue: `${TOKEN_GROUP}${label}`,
    }));
}

export function getSettingsSuggestions(query: string): SettingsSuggestion[] {
  const activeToken = getActiveToken(query);
  const normalizedToken = normalize(activeToken);

  if (!normalizedToken.startsWith("@")) {
    return [];
  }

  if (normalizedToken.startsWith(TOKEN_GROUP)) {
    return buildGroupSuggestions(normalizedToken.slice(TOKEN_GROUP.length));
  }

  const tokenSuggestions: SettingsSuggestion[] = [
    {
      id: TOKEN_MODIFIED,
      kind: "token" as const,
      label: TOKEN_MODIFIED,
      insertValue: TOKEN_MODIFIED,
      description: "仅显示已偏离默认值的设置",
    },
    {
      id: TOKEN_GROUP,
      kind: "token" as const,
      label: TOKEN_GROUP,
      insertValue: TOKEN_GROUP,
      description: "按分组筛选，例如 @group:数据源",
    },
  ].filter((suggestion) => suggestion.label.startsWith(normalizedToken));

  return [...tokenSuggestions, ...buildGroupSuggestions(normalizedToken.slice(1))].slice(0, 8);
}

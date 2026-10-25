/** One actor: the name every scrape writes, and the spellings sites use for them. */
export interface ActorAliasGroup {
  name: string;
  aliases: string[];
}

export type ResolvedActorAlias = {
  canonicalName: string;
  aliases: string[];
};

export const normalizeActorName = (value: string): string => value.normalize("NFKC").replace(/\s+/gu, "").toLowerCase();

export const toTrimmedActorName = (value: string | undefined | null): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
};

export const toUniqueActorNames = (
  values: ReadonlyArray<string | undefined | null>,
  normalizeValue: (value: string | undefined) => string | undefined = toTrimmedActorName,
): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalizedValue = normalizeValue(value ?? undefined);
    const normalizedName = normalizeActorName(normalizedValue ?? "");
    if (!normalizedValue || !normalizedName || seen.has(normalizedName)) {
      continue;
    }

    seen.add(normalizedName);
    output.push(normalizedValue);
  }

  return output;
};

export const normalizeActorAliasGroups = (groups: readonly ActorAliasGroup[]): ActorAliasGroup[] =>
  groups.map((group) => {
    const name = group.name.trim();
    return {
      name,
      aliases: toUniqueActorNames(group.aliases).filter(
        (alias) => normalizeActorName(alias) !== normalizeActorName(name),
      ),
    };
  });

const findActorAliasGroup = (groups: readonly ActorAliasGroup[], name: string): ResolvedActorAlias | undefined => {
  const normalizedName = normalizeActorName(name);
  if (!normalizedName) {
    return undefined;
  }

  const group = groups.find((candidate) =>
    [candidate.name, ...candidate.aliases].some((alias) => normalizeActorName(alias) === normalizedName),
  );
  return group && { canonicalName: group.name, aliases: toUniqueActorNames([group.name, ...group.aliases]) };
};

export const resolveActorAlias = (actorAliases: readonly ActorAliasGroup[], value: string): ResolvedActorAlias => {
  const name = toTrimmedActorName(value) ?? "";
  return findActorAliasGroup(actorAliases, name) ?? { canonicalName: name, aliases: name ? [name] : [] };
};

export const resolveActorAliasCandidates = (
  actorAliases: readonly ActorAliasGroup[],
  values: ReadonlyArray<string | undefined | null>,
): ResolvedActorAlias => {
  const names = toUniqueActorNames(values);
  const [firstName] = names;
  if (!firstName) {
    return { canonicalName: "", aliases: [] };
  }

  let group: ResolvedActorAlias | undefined;
  for (const name of names) {
    group = findActorAliasGroup(actorAliases, name);
    if (group) {
      break;
    }
  }

  const match = group ?? { canonicalName: firstName, aliases: [firstName] };
  return {
    canonicalName: match.canonicalName,
    aliases: toUniqueActorNames([match.canonicalName, ...match.aliases, ...names]),
  };
};

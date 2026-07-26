export type ActorAliasMap = Record<string, string[]>;

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

export const normalizeActorAliasMap = (actorAliases: Record<string, ReadonlyArray<string>>): ActorAliasMap => {
  const output: ActorAliasMap = {};

  for (const [rawCanonicalName, rawAliases] of Object.entries(actorAliases)) {
    const canonicalName = toTrimmedActorName(rawCanonicalName);
    if (!canonicalName) {
      continue;
    }

    output[canonicalName] = toUniqueActorNames(rawAliases).filter(
      (alias) => normalizeActorName(alias) !== normalizeActorName(canonicalName),
    );
  }

  return output;
};

export const resolveActorAlias = (actorAliases: ActorAliasMap, value: string): ResolvedActorAlias => {
  const name = toTrimmedActorName(value) ?? "";
  const normalizedName = normalizeActorName(name);

  for (const [canonicalName, aliases] of Object.entries(actorAliases)) {
    const candidates = [canonicalName, ...aliases];
    if (!candidates.some((candidate) => normalizeActorName(candidate) === normalizedName)) {
      continue;
    }

    return {
      canonicalName,
      aliases: toUniqueActorNames(candidates),
    };
  }

  return {
    canonicalName: name,
    aliases: name ? [name] : [],
  };
};

export const resolveActorAliasCandidates = (
  actorAliases: ActorAliasMap,
  values: ReadonlyArray<string | undefined | null>,
): ResolvedActorAlias => {
  const names = toUniqueActorNames(values);
  const resolved = names.map((name) => resolveActorAlias(actorAliases, name));
  const configured = resolved.find((entry) => entry.aliases.length > 1 || entry.canonicalName !== names[0]);
  const match = configured ?? resolved[0];

  if (!match) {
    return { canonicalName: "", aliases: [] };
  }

  return {
    canonicalName: match.canonicalName,
    aliases: toUniqueActorNames([match.canonicalName, ...match.aliases, ...names]),
  };
};

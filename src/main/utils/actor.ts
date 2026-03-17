export const normalizeActorName = (value: string): string => {
  return value.normalize("NFKC").replace(/\s+/gu, "").toLowerCase();
};

export const toTrimmedActorName = (value: string | undefined | null): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
};

export const toUniqueActorNames = (
  values: ReadonlyArray<string | undefined>,
  normalizeValue: (value: string | undefined) => string | undefined = toTrimmedActorName,
): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalizedValue = normalizeValue(value);
    const normalizedName = normalizeActorName(normalizedValue ?? "");
    if (!normalizedValue || !normalizedName || seen.has(normalizedName)) {
      continue;
    }

    seen.add(normalizedName);
    output.push(normalizedValue);
  }

  return output;
};

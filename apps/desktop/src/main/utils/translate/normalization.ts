export const normalizeKeyword = (input: string): string => input.normalize("NFC").trim().toUpperCase();

export const normalizeTokens = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeKeyword(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(value.trim());
  }

  return result;
};

export const toTokenArray = (value: string[] | string | undefined): string[] => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    return value.split(",");
  }

  return [];
};

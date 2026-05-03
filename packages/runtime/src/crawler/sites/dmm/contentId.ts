export const normalizeContentIds = (value: string): string[] => {
  const normalized = value.trim().toLowerCase();
  const matched = normalized.match(/(\d*[a-z]+)-?(\d+)/u);
  if (!matched) {
    const fallback = normalized.replace(/[^a-z0-9]/gu, "");
    return fallback.length > 0 ? [fallback] : [];
  }

  const rawPrefix = matched[1];
  const digits = matched[2];
  const prefix = rawPrefix.startsWith("1") ? rawPrefix.slice(1) : rawPrefix;
  const paddedDigits = digits.padStart(5, "0");

  const candidates = [
    `1${prefix}${paddedDigits}`,
    `${prefix}${paddedDigits}`,
    `1${prefix}${digits}`,
    `${prefix}${digits}`,
  ];

  if (rawPrefix.startsWith("1")) {
    candidates.unshift(`${rawPrefix}${paddedDigits}`, `${rawPrefix}${digits}`);
  }

  return Array.from(new Set(candidates.filter((item) => item.length > 0)));
};

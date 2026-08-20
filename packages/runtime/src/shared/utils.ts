export { toErrorMessage } from "@mdcz/shared/error";

export function parseRetryAfterMs(rawValue: string | null | undefined): number | null {
  if (!rawValue) {
    return null;
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  const delaySeconds = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(delaySeconds) && delaySeconds > 0) {
    return delaySeconds * 1000;
  }

  const date = new Date(trimmed);
  if (!Number.isNaN(date.getTime())) {
    const delayMs = date.getTime() - Date.now();
    return delayMs > 0 ? delayMs : null;
  }

  return null;
}

export function readRetryAfterHeader(headers: unknown): string | null {
  if (!headers) {
    return null;
  }

  if (typeof headers === "object" && "get" in headers && typeof headers.get === "function") {
    const value = headers.get("retry-after");
    return typeof value === "string" ? value : null;
  }

  if (typeof headers === "object" && headers !== null) {
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      if (key.toLowerCase() === "retry-after" && typeof value === "string") {
        return value;
      }
    }
  }

  return null;
}

export function normalizeCode(value: string | undefined | null): string {
  if (!value) return "";
  return value
    .trim()
    .replace(/[\s\-_]+/gu, "")
    .toUpperCase();
}

export function normalizeText(value: string | undefined | null): string {
  if (!value) return "";
  return value.trim().replace(/\s+/gu, " ");
}

export const uniqueStrings = (values: Array<string | undefined>): string[] => {
  const cleaned = values.map((value) => value?.trim() ?? "").filter((value) => value.length > 0);
  return Array.from(new Set(cleaned));
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a dot-separated path out of an unknown value, falling back when any segment is missing. */
export function getProperty<T = unknown>(obj: unknown, path: string, defaultValue?: T): T | undefined {
  let current: unknown = obj;

  for (const key of path.split(".")) {
    if (!isRecord(current) || !(key in current)) {
      return defaultValue;
    }
    current = current[key];
  }

  return current as T;
}

/** Builds a URL from a base, a pathname, and query entries. Empty query values are dropped. */
export function buildUrl(baseUrl: string, pathname = "/", query: Record<string, string | undefined> = {}): string {
  const url = new URL(pathname, `${baseUrl}/`);

  for (const [key, value] of Object.entries(query)) {
    if (!value) {
      continue;
    }
    url.searchParams.set(key, value);
  }

  return url.toString();
}

export const normalizeDmmNumberVariants = (raw: string): { number00: string; numberNo00: string } => {
  let normalized = raw.trim().toLowerCase();
  const match = normalized.match(/\d*[a-z]+-?(\d+)/u);
  if (match) {
    const digits = match[1];
    if (digits.length >= 5 && digits.startsWith("00")) {
      normalized = normalized.replace(digits, digits.slice(2));
    } else if (digits.length === 4) {
      normalized = normalized.replace("-", "0");
    }
  }

  return {
    number00: normalized.replace("-", "00"),
    numberNo00: normalized.replace("-", ""),
  };
};

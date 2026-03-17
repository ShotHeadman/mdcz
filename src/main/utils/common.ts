/**
 * Shared utility functions used across the application
 */

const normalizeWhitespace = (value: string): string => value.replace(/\s+/gu, " ").trim();
const stripImpitPrefix = (value: string): string => value.replace(/^impit error:\s*/iu, "").trim();

const extractLastMatch = (value: string, pattern: RegExp): string | undefined => {
  const matches = Array.from(value.matchAll(pattern));
  return matches.at(-1)?.[1];
};

const summarizeImpitError = (message: string): string | null => {
  const flattened = normalizeWhitespace(message);
  const normalized = stripImpitPrefix(flattened);
  const nestedError = extractLastMatch(normalized, /\berror:\s*"([^"]+)"/giu);
  const osMessage = extractLastMatch(normalized, /\bmessage:\s*"([^"]+)"/giu);
  const detail = nestedError ?? osMessage;

  if (/^(?:ConnectError:\s*)?Failed to connect to the server\.?/iu.test(normalized)) {
    return detail ? `ConnectError: ${detail}` : "ConnectError: failed to connect to the server";
  }

  if (/^impit error:/iu.test(flattened)) {
    return normalized;
  }

  return null;
};

export function formatErrorMessage(message: string): string {
  const summarizedImpitError = summarizeImpitError(message);
  if (summarizedImpitError) {
    return summarizedImpitError;
  }

  return normalizeWhitespace(message);
}

/**
 * Converts an unknown error to a string message
 */
export function toErrorMessage(error: unknown): string {
  let message: string;

  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else {
    message = String(error);
  }

  return formatErrorMessage(message);
}

/**
 * Converts a value to an array. If already an array, returns as-is.
 * If undefined, returns empty array. Otherwise wraps in array.
 */
export function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/**
 * Type guard to check if a value is a record object
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Type guard to check if a value is a string
 */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Safely gets a nested property from an object
 */
export function getProperty<T = unknown>(obj: unknown, path: string, defaultValue?: T): T | undefined {
  if (!isRecord(obj)) {
    return defaultValue;
  }

  const keys = path.split(".");
  let current: unknown = obj;

  for (const key of keys) {
    if (!isRecord(current) || !(key in current)) {
      return defaultValue;
    }
    current = current[key];
  }

  return current as T;
}

/**
 * Sets a nested property on an object, creating intermediate objects as needed
 */
export function setProperty(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let current: Record<string, unknown> = obj;

  for (const key of keys.slice(0, -1)) {
    const next = current[key];
    if (!isRecord(next)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  const tail = keys.at(-1);
  if (tail) {
    current[tail] = value;
  }
}

/**
 * Builds a URL with optional query parameters.
 */
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

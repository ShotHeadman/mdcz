/**
 * Shared utility functions used across the application
 */

/**
 * Converts an unknown error to a string message
 */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
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

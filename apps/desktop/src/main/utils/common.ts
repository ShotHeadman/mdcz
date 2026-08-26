/**
 * Shared utility functions used across the application
 */
import { isRecord } from "@mdcz/runtime/shared";

export { buildUrl, getProperty, isRecord } from "@mdcz/runtime/shared";
export { formatErrorMessage, toErrorMessage } from "@mdcz/shared/error";

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
 * Type guard to check if a value is a string
 */
export function isString(value: unknown): value is string {
  return typeof value === "string";
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
 * Recursively merges plain objects.
 * Arrays and explicit values replace the base value; undefined leaves it unchanged.
 */
export function mergeDeep<T>(base: T, override: unknown): T {
  if (override === undefined) {
    return base;
  }

  if (Array.isArray(base) || Array.isArray(override)) {
    return override as T;
  }

  if (isRecord(base) && isRecord(override)) {
    const output: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(override)) {
      if (value === undefined) {
        continue;
      }
      output[key] = mergeDeep(output[key], value);
    }
    return output as T;
  }

  return override as T;
}

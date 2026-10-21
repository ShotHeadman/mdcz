/**
 * Shared utility functions used across the application
 */
import { isRecord } from "@mdcz/runtime/shared";

export { buildUrl, getProperty, isRecord } from "@mdcz/runtime/shared";
export { formatErrorMessage, toErrorMessage } from "@mdcz/shared/error";

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

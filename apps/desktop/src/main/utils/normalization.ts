/**
 * Shared normalization utilities for text processing
 */

/**
 * Normalizes a code/number string by removing common separators and converting to uppercase
 * Used for comparing video codes, product IDs, etc.
 */
export function normalizeCode(value: string | undefined | null): string {
  if (!value) {
    return "";
  }
  return value
    .trim()
    .replace(/[\s\-_]+/g, "")
    .toUpperCase();
}

/**
 * Normalizes text for general comparison by trimming and collapsing whitespace
 */
export function normalizeText(value: string | undefined | null): string {
  if (!value) {
    return "";
  }
  return value.trim().replace(/\s+/g, " ");
}

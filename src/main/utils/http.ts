/**
 * HTTP-related utility functions
 */

/**
 * Parses a Retry-After header value to milliseconds
 * Supports both delay-seconds (integer) and HTTP-date formats
 *
 * @param rawValue - The raw Retry-After header value
 * @returns Delay in milliseconds, or null if invalid/not present
 */
export function parseRetryAfterMs(rawValue: string | null | undefined): number | null {
  if (!rawValue) {
    return null;
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  // Try parsing as delay-seconds (integer)
  const delaySeconds = parseInt(trimmed, 10);
  if (!Number.isNaN(delaySeconds) && delaySeconds > 0) {
    return delaySeconds * 1000;
  }

  // Try parsing as HTTP-date
  const date = new Date(trimmed);
  if (!Number.isNaN(date.getTime())) {
    const delayMs = date.getTime() - Date.now();
    return delayMs > 0 ? delayMs : null;
  }

  return null;
}

/**
 * Reads the Retry-After header from various header formats
 * Handles both plain objects and Headers instances
 *
 * @param headers - Headers object (plain object, Headers instance, or unknown)
 * @returns The Retry-After header value, or null if not found
 */
export function readRetryAfterHeader(headers: unknown): string | null {
  if (!headers) {
    return null;
  }

  // Handle Headers instance (fetch API)
  if (typeof headers === "object" && "get" in headers && typeof headers.get === "function") {
    const value = headers.get("retry-after");
    return typeof value === "string" ? value : null;
  }

  // Handle plain object
  if (typeof headers === "object" && headers !== null) {
    const headersObj = headers as Record<string, unknown>;

    // Try exact case
    if ("retry-after" in headersObj) {
      const value = headersObj["retry-after"];
      return typeof value === "string" ? value : null;
    }

    // Try case-insensitive search
    for (const [key, value] of Object.entries(headersObj)) {
      if (key.toLowerCase() === "retry-after" && typeof value === "string") {
        return value;
      }
    }
  }

  return null;
}

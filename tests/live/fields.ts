import type { CrawlerData } from "@mdcz/shared/types";
import type { LiveRequiredField } from "./catalog";

/** Validate required fields on crawler data and return a redacted-friendly observation summary. */
export const assertLiveRequiredFields = (data: CrawlerData, requiredFields: readonly LiveRequiredField[]): string => {
  if (requiredFields.length === 0) {
    throw new Error("At least one required field must be validated");
  }

  return requiredFields
    .map((field) => {
      const value = data[field];
      if (typeof value === "string" && value.trim()) {
        return `${field}=${value.trim()}`;
      }
      if (Array.isArray(value) && value.some((item) => typeof item === "string" && item.trim())) {
        const joined = value
          .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
          .join(", ");
        return `${field}=${joined}`;
      }
      throw new Error(`Required field '${field}' is missing from the crawler result`);
    })
    .join("; ");
};

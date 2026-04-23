import { normalizeEnabledSites } from "@/components/config-form/OrderedSiteField";

export interface OrderedSiteSummary {
  enabledCount: number;
  totalCount: number;
  preview: string[];
  remainingCount: number;
}

export function buildOrderedSiteSummary(value: unknown, options: string[]): OrderedSiteSummary {
  const enabledSites = normalizeEnabledSites(
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [],
  );
  const availableOptions = normalizeEnabledSites(options);
  const preview = enabledSites.slice(0, 3);

  return {
    enabledCount: enabledSites.length,
    totalCount: availableOptions.length,
    preview,
    remainingCount: Math.max(0, enabledSites.length - preview.length),
  };
}

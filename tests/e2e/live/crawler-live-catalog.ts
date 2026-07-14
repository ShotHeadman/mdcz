import { Website } from "@mdcz/shared/enums";

export const CRAWLER_LIVE_CATALOG_VERSION = "2026-07-13";

export const CRAWLER_LIVE_REQUIRED_FIELDS = ["number", "title", "website", "thumb_url", "actors"] as const;

export type CrawlerLiveRequiredField = (typeof CRAWLER_LIVE_REQUIRED_FIELDS)[number];

export interface CrawlerLiveCase {
  id: string;
  site: Website;
  number: string;
  label: string;
  requiredFields: CrawlerLiveRequiredField[];
  enabledByDefault: boolean;
  notes?: string;
}

export const CRAWLER_LIVE_CASES: readonly CrawlerLiveCase[] = [
  {
    id: "javdb-ssis-243",
    site: Website.JAVDB,
    number: "SSIS-243",
    label: "JavDB standard catalog entry",
    requiredFields: ["title"],
    enabledByDefault: true,
  },
  {
    id: "dmm-ssis-497",
    site: Website.DMM,
    number: "SSIS-497",
    label: "DMM standard catalog entry",
    requiredFields: ["title"],
    enabledByDefault: true,
  },
  {
    id: "javbus-abp-075",
    site: Website.JAVBUS,
    number: "ABP-075",
    label: "JavBus standard catalog entry",
    requiredFields: ["title"],
    enabledByDefault: true,
  },
] as const;

const DEFAULT_CRITICAL_SITES = [Website.JAVDB, Website.DMM, Website.JAVBUS] as const;
const REQUIRED_FIELD_SET = new Set<string>(CRAWLER_LIVE_REQUIRED_FIELDS);
const SENSITIVE_KEY_PATTERN = /(?:authorization|cookie|headers?|password|private.?path|raw.?response|secret|token)/iu;
const SENSITIVE_VALUE_PATTERN = /(?:\bbearer\s+[a-z0-9._~+/-]+=*|(?:^|[\\/])users?[\\/]|\/home\/|[a-z]:\\)/iu;

const collectSensitiveKeys = (value: unknown, path = "case"): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectSensitiveKeys(item, `${path}[${index}]`));
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  return Object.entries(value).flatMap(([key, nested]) => [
    ...(SENSITIVE_KEY_PATTERN.test(key) ? [`${path}.${key}`] : []),
    ...collectSensitiveKeys(nested, `${path}.${key}`),
  ]);
};

export const validateCrawlerLiveCatalog = (
  cases: readonly CrawlerLiveCase[],
  registeredSites: readonly Website[],
  criticalSites: readonly Website[] = DEFAULT_CRITICAL_SITES,
): string[] => {
  const errors: string[] = [];
  const ids = new Set<string>();
  const registeredSiteSet = new Set<Website>(registeredSites);

  for (const liveCase of cases) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(liveCase.id)) {
      errors.push(`Case id '${liveCase.id}' must be a stable kebab-case identifier`);
    }
    if (ids.has(liveCase.id)) {
      errors.push(`Duplicate case id '${liveCase.id}'`);
    }
    ids.add(liveCase.id);

    if (!registeredSiteSet.has(liveCase.site)) {
      errors.push(`Case '${liveCase.id}' references unregistered site '${liveCase.site}'`);
    }
    if (!liveCase.number.trim()) {
      errors.push(`Case '${liveCase.id}' has a blank public identifier`);
    }
    if (/[:\\/]|[\r\n]/u.test(liveCase.number)) {
      errors.push(`Case '${liveCase.id}' identifier must not contain a URL, path, or line break`);
    }
    if (!liveCase.label.trim()) {
      errors.push(`Case '${liveCase.id}' has a blank label`);
    }
    if (liveCase.requiredFields.length === 0) {
      errors.push(`Case '${liveCase.id}' must require at least one stable field`);
    }
    const uniqueFields = new Set(liveCase.requiredFields);
    if (uniqueFields.size !== liveCase.requiredFields.length) {
      errors.push(`Case '${liveCase.id}' contains duplicate required fields`);
    }
    for (const field of liveCase.requiredFields) {
      if (!REQUIRED_FIELD_SET.has(field)) {
        errors.push(`Case '${liveCase.id}' contains unsupported required field '${field}'`);
      }
    }

    for (const sensitivePath of collectSensitiveKeys(liveCase)) {
      errors.push(`Case '${liveCase.id}' contains sensitive field '${sensitivePath}'`);
    }
    if (SENSITIVE_VALUE_PATTERN.test(JSON.stringify(liveCase))) {
      errors.push(`Case '${liveCase.id}' contains a credential or private path value`);
    }
  }

  for (const criticalSite of criticalSites) {
    if (!cases.some((liveCase) => liveCase.enabledByDefault && liveCase.site === criticalSite)) {
      errors.push(`Critical site '${criticalSite}' has no default live case`);
    }
  }

  return errors;
};

export const assertCrawlerLiveCatalog = (
  cases: readonly CrawlerLiveCase[],
  registeredSites: readonly Website[],
): void => {
  const errors = validateCrawlerLiveCatalog(cases, registeredSites);
  if (errors.length > 0) {
    throw new Error(`Invalid crawler live catalog:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
};

import { Website } from "@mdcz/shared/enums";

export const LIVE_CATALOG_VERSION = "2026-07-15";

/** Fields every live case must require. */
export const COMMON_LIVE_REQUIRED_FIELDS = ["number", "title", "website"] as const;

/** Fields allowed in a live case requiredFields list (common + evidence-backed extras). */
export const LIVE_ALLOWED_REQUIRED_FIELDS = ["number", "title", "website", "thumb_url", "actors"] as const;

export type LiveRequiredField = (typeof LIVE_ALLOWED_REQUIRED_FIELDS)[number];

export interface LiveCase {
  id: string;
  site: Website;
  number: string;
  label: string;
  requiredFields: LiveRequiredField[];
  enabledByDefault: boolean;
  notes?: string;
}

/**
 * Live network catalog is intentionally DMM-only.
 * Goal: prove one rich real provider + downstream workbench pipeline.
 * JavDB/JavBus remain covered by offline unit tests, not default live discovery.
 */
export const WORKBENCH_LIVE_CASE_ID = "dmm-ssis-497" as const;

export const LIVE_CASES: readonly LiveCase[] = [
  {
    id: "dmm-ssis-497",
    site: Website.DMM,
    number: "SSIS-497",
    label: "DMM representative catalog entry for live provider + workbench pipeline",
    requiredFields: ["number", "title", "website"],
    enabledByDefault: true,
    notes: "Primary live egress expectation is JP. Non-JP DMM region blocks are external constraints.",
  },
] as const;

const DEFAULT_CRITICAL_SITES = [Website.DMM] as const;
const ALLOWED_FIELD_SET = new Set<string>(LIVE_ALLOWED_REQUIRED_FIELDS);
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

export const resolveLiveCase = (caseId: string, cases: readonly LiveCase[] = LIVE_CASES): LiveCase => {
  const liveCase = cases.find((entry) => entry.id === caseId);
  if (!liveCase) {
    throw new Error(`Unknown live case id '${caseId}'`);
  }
  return liveCase;
};

export const resolveWorkbenchLiveCase = (cases: readonly LiveCase[] = LIVE_CASES): LiveCase =>
  resolveLiveCase(WORKBENCH_LIVE_CASE_ID, cases);

export const validateLiveCatalog = (
  cases: readonly LiveCase[],
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
      if (!ALLOWED_FIELD_SET.has(field)) {
        errors.push(`Case '${liveCase.id}' contains unsupported required field '${field}'`);
      }
    }
    for (const field of COMMON_LIVE_REQUIRED_FIELDS) {
      if (!uniqueFields.has(field)) {
        errors.push(`Case '${liveCase.id}' must require common field '${field}'`);
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

  if (!cases.some((liveCase) => liveCase.id === WORKBENCH_LIVE_CASE_ID && liveCase.enabledByDefault)) {
    errors.push(`Workbench live case '${WORKBENCH_LIVE_CASE_ID}' must be present and enabled by default`);
  }

  return errors;
};

export const assertLiveCatalog = (cases: readonly LiveCase[], registeredSites: readonly Website[]): void => {
  const errors = validateLiveCatalog(cases, registeredSites);
  if (errors.length > 0) {
    throw new Error(`Invalid live catalog:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
};

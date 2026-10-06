import { Website } from "@mdcz/shared/enums";
import type { SiteHealth, SiteResult } from "@mdcz/shared/siteResults";
import { getCrawlerConstructor } from "../crawler/registry";
import { isLikelyUncensoredNumber } from "./utils/movieClassification";

export type AdmissionReject = SiteResult & { status: "skipped" };

type Fc2Role = "fc2_only" | "fc2_capable";

const FC2_ROLE: Partial<Record<Website, Fc2Role>> = {
  [Website.FC2]: "fc2_only",
  [Website.FC2HUB]: "fc2_only",
  [Website.PPVDATABANK]: "fc2_only",
  [Website.JAVDB]: "fc2_capable",
};

type Credential = "fantiaCookie" | "javdbCookie";

const CREDENTIAL_DEPENDENCIES: Partial<
  Record<Website, { credential: Credential; appliesTo?: (number: string) => boolean }>
> = {
  [Website.FANTIA]: { credential: "fantiaCookie" },
  // JavDB serves FC2 and uncensored titles only to signed-in accounts; everything else stays public.
  [Website.JAVDB]: { credential: "javdbCookie", appliesTo: isLikelyUncensoredNumber },
};

const FC2_NUMBER_PATTERN = /^FC2[\s_-]*(?:PPV[\s_-]*)?\d+$/iu;

export interface SiteAdmissionInput {
  number: string;
  configuredSites: readonly Website[];
  credentials: Partial<Record<Credential, string>>;
  health: ReadonlyMap<Website, SiteHealth>;
  manualScrape?: { site: Website };
  now?: number;
}

const skip = (
  site: Website,
  skipReason: AdmissionReject["skipReason"],
  extra: Pick<SiteResult, "reason" | "detail"> = {},
): AdmissionReject => ({ site, status: "skipped", skipReason, elapsedMs: 0, ...extra });

export function resolveSiteAdmission(input: SiteAdmissionInput): {
  admitted: Website[];
  rejected: AdmissionReject[];
} {
  const candidates = input.manualScrape ? [input.manualScrape.site] : [...new Set(input.configuredSites)];
  const isFc2 = FC2_NUMBER_PATTERN.test(input.number.trim());
  const now = input.now ?? Date.now();
  const admitted: Website[] = [];
  const rejected: AdmissionReject[] = [];

  for (const site of candidates) {
    const role = FC2_ROLE[site];
    const numberPattern = getCrawlerConstructor(site)?.numberPattern;
    if (
      !input.manualScrape &&
      ((isFc2 && !role) ||
        (!isFc2 && role === "fc2_only") ||
        (numberPattern && !numberPattern.test(input.number.trim())))
    ) {
      rejected.push(skip(site, "number_mismatch"));
      continue;
    }

    const dependency = CREDENTIAL_DEPENDENCIES[site];
    const needsCredential = dependency !== undefined && (dependency.appliesTo?.(input.number) ?? true);
    if (!input.manualScrape && needsCredential && !input.credentials[dependency.credential]?.trim()) {
      rejected.push(skip(site, "missing_credential"));
      continue;
    }

    const health = input.health.get(site);
    if (health?.until !== undefined) {
      rejected.push(
        skip(site, "cooldown", { reason: health.reason, detail: `${Math.ceil((health.until - now) / 1000)}s` }),
      );
      continue;
    }
    // A login wall on a site whose credential covers only some titles leaves its other titles reachable.
    const blocksTitle = health?.reason !== "login_wall" || dependency === undefined || needsCredential;
    // Scraping one site by hand is how a user retries a site this network blocked.
    if (health && blocksTitle && !input.manualScrape) {
      rejected.push(skip(site, "unavailable", { reason: health.reason }));
      continue;
    }

    admitted.push(site);
  }

  return { admitted, rejected };
}

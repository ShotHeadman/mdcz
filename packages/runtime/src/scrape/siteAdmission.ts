import { Website } from "@mdcz/shared/enums";
import type { SiteHealth, SiteResult } from "@mdcz/shared/siteResults";
import { getCrawlerConstructor } from "../crawler/registry";
import { type ContentType, classifyNumber, isLikelyUncensoredNumber } from "./utils/movieClassification";

export type AdmissionReject = SiteResult & { status: "skipped" };

// An FC2 number carries a literal prefix; only the censored/uncensored guess can be wrong, so its sites stay in reserve.
const FALLBACK_CONTENT_TYPE: Record<ContentType, ContentType | undefined> = {
  censored: "uncensored",
  uncensored: "censored",
  fc2: undefined,
};

type Credential = "fantiaCookie" | "javdbCookie";

const CREDENTIAL_DEPENDENCIES: Partial<
  Record<Website, { credential: Credential; appliesTo?: (number: string) => boolean }>
> = {
  [Website.FANTIA]: { credential: "fantiaCookie" },
  // JavDB serves FC2 and uncensored titles only to signed-in accounts; everything else stays public.
  [Website.JAVDB]: { credential: "javdbCookie", appliesTo: isLikelyUncensoredNumber },
};

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

/** Admitted sites run first; deferred sites serve only the fallback content type and run when every admitted site misses. */
export function resolveSiteAdmission(input: SiteAdmissionInput): {
  admitted: Website[];
  deferred: Website[];
  rejected: AdmissionReject[];
} {
  const candidates = input.manualScrape ? [input.manualScrape.site] : [...new Set(input.configuredSites)];
  const number = input.number.trim();
  const contentType = classifyNumber(number);
  const fallbackType = FALLBACK_CONTENT_TYPE[contentType];
  const now = input.now ?? Date.now();
  const admitted: Website[] = [];
  const deferred: Website[] = [];
  const rejected: AdmissionReject[] = [];

  for (const site of candidates) {
    const crawler = getCrawlerConstructor(site);
    const serves = (type: ContentType) => crawler?.contentTypes?.includes(type) ?? false;
    const matches = crawler?.numberPattern ? crawler.numberPattern.test(number) : serves(contentType);
    const isDeferred = !matches && !input.manualScrape && fallbackType !== undefined && serves(fallbackType);
    if (!matches && !input.manualScrape && !isDeferred) {
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

    (isDeferred ? deferred : admitted).push(site);
  }

  return { admitted, deferred, rejected };
}

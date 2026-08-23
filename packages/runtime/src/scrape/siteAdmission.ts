import { Website } from "@mdcz/shared/enums";

export type AdmissionReject = {
  site: Website;
  reason: "number_mismatch" | "missing_credential" | "cooldown";
  detail?: string;
};

type Fc2Role = "fc2_only" | "fc2_capable";

const FC2_ROLE: Partial<Record<Website, Fc2Role>> = {
  [Website.FC2]: "fc2_only",
  [Website.FC2HUB]: "fc2_only",
  [Website.PPVDATABANK]: "fc2_only",
  [Website.JAVDB]: "fc2_capable",
};

const CREDENTIAL_DEPENDENCIES: Partial<Record<Website, "fantiaCookie">> = {
  [Website.FANTIA]: "fantiaCookie",
};

const FC2_NUMBER_PATTERN = /^FC2-?\d+$/iu;

export interface SiteAdmissionInput {
  number: string;
  configuredSites: readonly Website[];
  credentials: { fantiaCookie?: string };
  cooldowns: ReadonlyMap<Website, { remainingMs: number; cooldownUntil: number }>;
  manualScrape?: { site: Website };
}

export function resolveSiteAdmission(input: SiteAdmissionInput): {
  admitted: Website[];
  rejected: AdmissionReject[];
} {
  const candidates = input.manualScrape ? [input.manualScrape.site] : [...new Set(input.configuredSites)];
  const isFc2 = FC2_NUMBER_PATTERN.test(input.number.trim());
  const admitted: Website[] = [];
  const rejected: AdmissionReject[] = [];

  for (const site of candidates) {
    const role = FC2_ROLE[site];
    if (!input.manualScrape && ((isFc2 && !role) || (!isFc2 && role === "fc2_only"))) {
      rejected.push({ site, reason: "number_mismatch" });
      continue;
    }

    const credential = CREDENTIAL_DEPENDENCIES[site];
    if (!input.manualScrape && credential && !input.credentials[credential]?.trim()) {
      rejected.push({ site, reason: "missing_credential" });
      continue;
    }

    const cooldown = input.cooldowns.get(site);
    if (cooldown && cooldown.remainingMs > 0) {
      rejected.push({
        site,
        reason: "cooldown",
        detail: `${Math.ceil(cooldown.remainingMs / 1000)}s`,
      });
      continue;
    }

    admitted.push(site);
  }

  return { admitted, rejected };
}

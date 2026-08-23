import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";
import { resolveSiteAdmission } from "./siteAdmission";

const allSites = Object.values(Website);
const noCooldowns = new Map();

const admit = (number: string, overrides: Partial<Parameters<typeof resolveSiteAdmission>[0]> = {}) =>
  resolveSiteAdmission({
    number,
    configuredSites: allSites,
    credentials: { fantiaCookie: "fantia_session=ok" },
    cooldowns: noCooldowns,
    ...overrides,
  });

describe("resolveSiteAdmission", () => {
  it.each(["FC2-1234", "FC21234"])("keeps only FC2-capable sites for %s", (number) => {
    expect(admit(number).admitted).toEqual([Website.FC2, Website.FC2HUB, Website.PPVDATABANK, Website.JAVDB]);
  });

  it("excludes FC2-only sites for non-FC2 numbers but keeps JavDB", () => {
    const result = admit("SNOS-309");

    expect(result.admitted).toContain(Website.JAVDB);
    expect(result.admitted).not.toEqual(expect.arrayContaining([Website.FC2, Website.FC2HUB, Website.PPVDATABANK]));
    expect(result.rejected.filter(({ reason }) => reason === "number_mismatch").map(({ site }) => site)).toEqual([
      Website.FC2,
      Website.FC2HUB,
      Website.PPVDATABANK,
    ]);
  });

  it("rejects Fantia without a cookie and admits it with a cookie", () => {
    const withoutCookie = admit("SNOS-309", { credentials: {} });
    expect(withoutCookie.rejected).toContainEqual({ site: Website.FANTIA, reason: "missing_credential" });

    const withCookie = admit("SNOS-309", { credentials: { fantiaCookie: "session=ok" } });
    expect(withCookie.admitted).toContain(Website.FANTIA);
  });

  it("rejects cooling-down sites with remaining time detail", () => {
    const result = admit("SNOS-309", {
      configuredSites: [Website.DMM],
      cooldowns: new Map([[Website.DMM, { remainingMs: 42_000, cooldownUntil: 1_000_000 }]]),
    });

    expect(result).toEqual({
      admitted: [],
      rejected: [{ site: Website.DMM, reason: "cooldown", detail: "42s" }],
    });
  });

  it("manual scraping bypasses number and credential checks but still honors cooldown", () => {
    const admitted = resolveSiteAdmission({
      number: "SNOS-309",
      configuredSites: [Website.FANTIA],
      credentials: {},
      cooldowns: noCooldowns,
      manualScrape: { site: Website.FANTIA },
    });
    expect(admitted).toEqual({ admitted: [Website.FANTIA], rejected: [] });

    const coolingDown = resolveSiteAdmission({
      number: "SNOS-309",
      configuredSites: [Website.FANTIA],
      credentials: {},
      cooldowns: new Map([[Website.FANTIA, { remainingMs: 1, cooldownUntil: 1_000_001 }]]),
      manualScrape: { site: Website.FANTIA },
    });
    expect(coolingDown.rejected[0]).toMatchObject({ site: Website.FANTIA, reason: "cooldown" });
  });

  it("reports the first rejection in admission order", () => {
    const result = resolveSiteAdmission({
      number: "SNOS-309",
      configuredSites: [Website.FANTIA, Website.FC2],
      credentials: {},
      cooldowns: new Map([
        [Website.FANTIA, { remainingMs: 1_000, cooldownUntil: 1_001_000 }],
        [Website.FC2, { remainingMs: 1_000, cooldownUntil: 1_001_000 }],
      ]),
    });

    expect(result.rejected).toEqual([
      { site: Website.FANTIA, reason: "missing_credential" },
      { site: Website.FC2, reason: "number_mismatch" },
    ]);
  });
});

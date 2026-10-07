import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";
import { resolveSiteAdmission } from "./siteAdmission";

const allSites = Object.values(Website);
const healthy = new Map();
const NOW = 1_000_000;

const admit = (number: string, overrides: Partial<Parameters<typeof resolveSiteAdmission>[0]> = {}) =>
  resolveSiteAdmission({
    number,
    configuredSites: allSites,
    credentials: { fantiaCookie: "fantia_session=ok", javdbCookie: "_jdb_session=ok" },
    health: healthy,
    now: NOW,
    ...overrides,
  });

const skipped = (site: Website, skipReason: string, extra: object = {}) => ({
  site,
  status: "skipped",
  skipReason,
  elapsedMs: 0,
  ...extra,
});

describe("resolveSiteAdmission", () => {
  const censoredCatalogs = [
    Website.DMM,
    Website.DMM_TV,
    Website.FANTIA,
    Website.JAV321,
    Website.KINGDOM,
    Website.R18_DEV,
    Website.SOKMIL,
    Website.AVBASE,
    Website.AVWIKIDB,
  ];
  it.each([
    ["FC2-1234", [Website.FC2, Website.FC2HUB, Website.PPVDATABANK, Website.JAVDB], []],
    ["HEYZO-3806", [Website.JAVBUS, Website.JAVDB, Website.HEYZO], censoredCatalogs],
    ["100524_001", [Website.JAVBUS, Website.JAVDB], censoredCatalogs],
    [
      "SNOS-309",
      [...censoredCatalogs.slice(0, 4), Website.JAVBUS, Website.JAVDB, ...censoredCatalogs.slice(4), Website.OFFICIAL],
      [],
    ],
  ])("routes %s to the sites serving its content type, holding the other type in reserve", (number, admitted, deferred) => {
    const result = admit(number);
    expect(result.admitted).toEqual(admitted);
    expect(result.deferred).toEqual(deferred);
  });

  it("excludes FC2-only sites for non-FC2 numbers but keeps JavDB", () => {
    const result = admit("SNOS-309");

    expect(result.admitted).toContain(Website.JAVDB);
    expect(result.admitted).not.toEqual(expect.arrayContaining([Website.FC2, Website.FC2HUB, Website.PPVDATABANK]));
    expect(
      result.rejected.filter(({ skipReason }) => skipReason === "number_mismatch").map(({ site }) => site),
    ).toEqual(
      expect.arrayContaining([
        Website.FC2,
        Website.FC2HUB,
        Website.PPVDATABANK,
        Website.DAHLIA,
        Website.FALENO,
        Website.KM_PRODUCE,
        Website.PRESTIGE,
        Website.MGSTAGE,
      ]),
    );
    for (const [number, site] of [
      ["DLDSS-300", Website.DAHLIA],
      ["FSDSS-564", Website.FALENO],
      ["MGOLD-001", Website.FALENO],
      ["JIMMY-001", Website.FALENO],
      ["REAL-001", Website.KM_PRODUCE],
      ["ABW-130", Website.PRESTIGE],
      ["300MIUM-001", Website.MGSTAGE],
      ["SNOS-301", Website.OFFICIAL],
      ["MIDA-732", Website.OFFICIAL],
      ["1PON-100524_001", Website.ONEPONDO],
      ["10MU-100524_01", Website.TENMUSUME],
      ["CARIB-100524-001", Website.CARIBBEANCOM],
      ["HEYZO-3806", Website.HEYZO],
      ["H0930-GOL205", Website.H0930],
      ["H4610-ORI1693", Website.H4610],
    ] as const) {
      expect(admit(number, { configuredSites: [site] }).admitted).toEqual([site]);
      expect(admit("UNRELATED-123", { configuredSites: [site] }).rejected).toEqual([skipped(site, "number_mismatch")]);
    }
  });

  it("requires a site's cookie only for the titles that need one", () => {
    const cases = [
      { site: Website.FANTIA, number: "SNOS-309", credentials: { fantiaCookie: "session=ok" }, needsCredential: true },
      { site: Website.JAVDB, number: "HEYZO-3806", credentials: { javdbCookie: "session=ok" }, needsCredential: true },
      { site: Website.JAVDB, number: "FC2-1234", credentials: { javdbCookie: "session=ok" }, needsCredential: true },
      { site: Website.JAVDB, number: "SNOS-309", credentials: { javdbCookie: "session=ok" }, needsCredential: false },
    ];
    for (const { site, number, credentials, needsCredential } of cases) {
      const withoutCookie = admit(number, { configuredSites: [site], credentials: {} });
      expect(withoutCookie.rejected, `${site} ${number}`).toEqual(
        needsCredential ? [skipped(site, "missing_credential")] : [],
      );
      expect(admit(number, { configuredSites: [site], credentials }).admitted, `${site} ${number}`).toEqual([site]);
    }
  });

  it("rejects paused sites with the failure that paused them", () => {
    const result = admit("SNOS-309", {
      configuredSites: [Website.DMM, Website.JAVDB],
      health: new Map([
        [Website.DMM, { reason: "region_blocked" as const }],
        [Website.JAVDB, { reason: "rate_limited" as const, until: NOW + 42_000 }],
      ]),
    });

    expect(result).toEqual({
      admitted: [],
      deferred: [],
      rejected: [
        skipped(Website.DMM, "unavailable", { reason: "region_blocked" }),
        skipped(Website.JAVDB, "cooldown", { reason: "rate_limited", detail: "42s" }),
      ],
    });

    const loginWalled = (number: string) =>
      admit(number, {
        configuredSites: [Website.JAVDB],
        health: new Map([[Website.JAVDB, { reason: "login_wall" as const }]]),
      });
    expect(loginWalled("SNOS-309").admitted).toEqual([Website.JAVDB]);
    expect(loginWalled("HEYZO-3806").rejected).toEqual([
      skipped(Website.JAVDB, "unavailable", { reason: "login_wall" }),
    ]);
  });

  it("manual scraping retries blocked sites and skips number and credential checks but honors cooldowns", () => {
    const manual = (health: Parameters<typeof resolveSiteAdmission>[0]["health"]) =>
      admit("SNOS-309", {
        configuredSites: [Website.FANTIA],
        credentials: {},
        health,
        manualScrape: { site: Website.FANTIA },
      });

    expect(manual(new Map([[Website.FANTIA, { reason: "login_wall" as const }]]))).toEqual({
      admitted: [Website.FANTIA],
      deferred: [],
      rejected: [],
    });
    expect(
      manual(new Map([[Website.FANTIA, { reason: "rate_limited" as const, until: NOW + 1 }]])).rejected[0],
    ).toMatchObject({ site: Website.FANTIA, skipReason: "cooldown" });
  });

  it("reports the first rejection in admission order", () => {
    const result = admit("SNOS-309", {
      configuredSites: [Website.FANTIA, Website.FC2],
      credentials: {},
      health: new Map([
        [Website.FANTIA, { reason: "timeout" as const, until: NOW + 1_000 }],
        [Website.FC2, { reason: "timeout" as const, until: NOW + 1_000 }],
      ]),
    });

    expect(result.rejected).toEqual([
      skipped(Website.FANTIA, "missing_credential"),
      skipped(Website.FC2, "number_mismatch"),
    ]);
  });
});

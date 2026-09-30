import { describe, expect, it } from "vitest";
import { defaultConfiguration } from "./config";
import { Website } from "./enums";
import { resolveManualScrapeRoute, validateManualScrapeUrl } from "./manualScrapeUrl";

const officialOnly = defaultConfiguration.network;
const withJavdbMirror = { ...officialOnly, javdbUrl: "https://javdb571.com/" };
const localMirrors = { javbusUrl: "http://localhost:8081", javdbUrl: "http://localhost:8082" };

describe("manual scrape URL routing", () => {
  it("routes official aliases and configured mirror origins to their home and detail pages", () => {
    for (const [url, network, site, detailUrl] of [
      [
        "https://www.h4610.com/moviepages/ori696/index.html",
        officialOnly,
        Website.H4610,
        "https://www.h4610.com/moviepages/ori696/index.html",
      ],
      ["https://javdb.com/v/abc", withJavdbMirror, Website.JAVDB, "https://javdb.com/v/abc"],
      ["https://www.javdb.com/v/abc", withJavdbMirror, Website.JAVDB, "https://www.javdb.com/v/abc"],
      ["https://javdb571.com/v/abc", withJavdbMirror, Website.JAVDB, "https://javdb571.com/v/abc"],
      ["http://localhost:8081/", localMirrors, Website.JAVBUS, undefined],
      ["http://localhost:8082/", localMirrors, Website.JAVDB, undefined],
      ["http://localhost:8081/ABC-123", localMirrors, Website.JAVBUS, "http://localhost:8081/ABC-123"],
      ["http://localhost:8082/v/abc", localMirrors, Website.JAVDB, "http://localhost:8082/v/abc"],
    ] as const) {
      expect(resolveManualScrapeRoute(url, network)).toEqual({ site, detailUrl });
      expect(validateManualScrapeUrl(url, network)).toEqual({
        valid: true,
        route: detailUrl
          ? { site, mode: "detail", url: detailUrl, detailUrl }
          : { site, mode: "site", url: new URL(url).toString() },
      });
    }
  });

  it("rejects blank input and hosts that are neither official nor configured mirrors", () => {
    expect(resolveManualScrapeRoute(" ", officialOnly)).toBeUndefined();
    expect(() => resolveManualScrapeRoute("https://example.com/movie", officialOnly)).toThrow("Unsupported site URL");
    for (const [url, network] of [
      ["https://javdb571.com/v/abc", officialOnly],
      ["http://localhost:8083/", localMirrors],
      ["https://localhost:8082/v/abc", localMirrors],
    ] as const) {
      expect(validateManualScrapeUrl(url, network)).toEqual({ valid: false, reason: "unsupported_site" });
    }
  });
});

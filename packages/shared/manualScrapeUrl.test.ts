import { describe, expect, it } from "vitest";
import { Website } from "./enums";
import { resolveManualScrapeRoute, validateManualScrapeUrl } from "./manualScrapeUrl";

describe("manual scrape URL routing", () => {
  it("routes an official H4610 detail page to H4610", () => {
    expect(resolveManualScrapeRoute("https://www.h4610.com/moviepages/ori696/index.html")).toEqual({
      site: Website.H4610,
      detailUrl: "https://www.h4610.com/moviepages/ori696/index.html",
    });
    expect(resolveManualScrapeRoute(" ")).toBeUndefined();
    expect(() => resolveManualScrapeRoute("https://example.com/movie")).toThrow("Unsupported site URL");
    expect(validateManualScrapeUrl("https://www.h4610.com/moviepages/ori696/index.html")).toEqual({
      valid: true,
      route: {
        site: Website.H4610,
        mode: "detail",
        url: "https://www.h4610.com/moviepages/ori696/index.html",
        detailUrl: "https://www.h4610.com/moviepages/ori696/index.html",
      },
    });
  });
});

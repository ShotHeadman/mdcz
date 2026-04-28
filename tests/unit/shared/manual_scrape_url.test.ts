import { Website } from "@mdcz/shared/enums";
import {
  MANUAL_SCRAPE_SUPPORTED_SITE_INVALID_MESSAGE,
  MANUAL_SCRAPE_UNSUPPORTED_SITE_MESSAGE,
  validateManualScrapeUrl,
} from "@mdcz/shared/manualScrapeUrl";
import { describe, expect, it } from "vitest";

describe("validateManualScrapeUrl", () => {
  it("routes supported site roots to a forced-site search", () => {
    expect(validateManualScrapeUrl("www.dmm.co.jp")).toEqual({
      valid: true,
      route: {
        site: Website.DMM,
        mode: "site",
        url: "https://www.dmm.co.jp/",
      },
    });
  });

  it("keeps DMM and DMM TV independent by host", () => {
    const dmm = validateManualScrapeUrl("https://www.dmm.co.jp/");
    const dmmTv = validateManualScrapeUrl("https://video.dmm.co.jp/");
    const fanzaTv = validateManualScrapeUrl("https://tv.dmm.co.jp/list/?content=ssni00103");

    expect(dmm.valid && dmm.route.site).toBe(Website.DMM);
    expect(dmmTv.valid && dmmTv.route.site).toBe(Website.DMM_TV);
    expect(fanzaTv.valid && fanzaTv.route.site).toBe(Website.DMM_TV);
  });

  it("routes supported detail URLs to direct detail parsing", () => {
    expect(validateManualScrapeUrl("https://video.dmm.co.jp/av/content/?id=1stars00804")).toEqual({
      valid: true,
      route: {
        site: Website.DMM_TV,
        mode: "detail",
        url: "https://video.dmm.co.jp/av/content/?id=1stars00804",
        detailUrl: "https://video.dmm.co.jp/av/content/?id=1stars00804",
      },
    });
    expect(validateManualScrapeUrl("https://tv.dmm.co.jp/list/?content=ssni00103&i3_ref=search")).toEqual({
      valid: true,
      route: {
        site: Website.DMM_TV,
        mode: "detail",
        url: "https://tv.dmm.co.jp/list/?content=ssni00103&i3_ref=search",
        detailUrl: "https://tv.dmm.co.jp/list/?content=ssni00103&i3_ref=search",
      },
    });
  });

  it("rejects supported hosts with unsupported paths using the required message", () => {
    expect(MANUAL_SCRAPE_SUPPORTED_SITE_INVALID_MESSAGE).toBe("请输入站点首页或详情地址");
    expect(validateManualScrapeUrl("https://www.dmm.co.jp/monthly/")).toEqual({
      valid: false,
      reason: "unsupported_path",
      message: MANUAL_SCRAPE_SUPPORTED_SITE_INVALID_MESSAGE,
    });
  });

  it("rejects unsupported hosts before queueing", () => {
    expect(validateManualScrapeUrl("https://example.com/title/123")).toEqual({
      valid: false,
      reason: "unsupported_site",
      message: MANUAL_SCRAPE_UNSUPPORTED_SITE_MESSAGE,
    });
  });
});

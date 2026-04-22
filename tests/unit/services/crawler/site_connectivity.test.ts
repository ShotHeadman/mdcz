import { type Configuration, defaultConfiguration } from "@main/services/config/models";
import {
  buildSiteConnectivityHeaders,
  probeSiteConnectivity,
  resolveSiteConnectivityTargetUrl,
} from "@main/services/crawler/siteConnectivity";
import { Website } from "@shared/enums";
import { describe, expect, it, vi } from "vitest";

const createConfiguration = (): Configuration => structuredClone(defaultConfiguration);

describe("siteConnectivity", () => {
  it("uses the saved custom URL when present", () => {
    const configuration = createConfiguration();
    configuration.scrape.siteConfigs[Website.JAVDB] = {
      customUrl: "https://mirror.example.com",
    };

    expect(resolveSiteConnectivityTargetUrl(Website.JAVDB, configuration)).toBe("https://mirror.example.com");
  });

  it("falls back to the built-in site origin when no custom URL is configured", () => {
    const configuration = createConfiguration();

    expect(resolveSiteConnectivityTargetUrl(Website.AVBASE, configuration)).toBe("https://www.avbase.net");
    expect(resolveSiteConnectivityTargetUrl(Website.DMM_TV, configuration)).toBe("https://video.dmm.co.jp/");
  });

  it("builds cookie headers from crawler settings and site-specific probe requirements", () => {
    const configuration = createConfiguration();
    configuration.network.javdbCookie = "auth=1";

    expect(buildSiteConnectivityHeaders(Website.JAVDB, configuration)).toEqual({
      cookie: "auth=1",
    });
    expect(buildSiteConnectivityHeaders(Website.MGSTAGE, configuration)).toEqual({
      cookie: "adc=1",
    });
    expect(buildSiteConnectivityHeaders(Website.SOKMIL, configuration)).toEqual({
      cookie: "AGEAUTH=ok",
    });
  });

  it("formats successful probe results with status and latency", async () => {
    const configuration = createConfiguration();
    const networkClient = {
      probe: vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        contentLength: null,
        resolvedUrl: "https://www.avbase.net",
      }),
    };

    const result = await probeSiteConnectivity(Website.AVBASE, configuration, networkClient);

    expect(result.ok).toBe(true);
    expect(result.status).toBe(204);
    expect(result.message).toMatch(/^HTTP 204 · \d+ms$/u);
    expect(networkClient.probe).toHaveBeenCalledWith(
      "https://www.avbase.net",
      expect.objectContaining({ timeout: 10000 }),
    );
  });

  it("returns a readable error message when the probe throws", async () => {
    const configuration = createConfiguration();
    const networkClient = {
      probe: vi.fn().mockRejectedValue(new Error("socket hang up")),
    };

    const result = await probeSiteConnectivity(Website.JAVBUS, configuration, networkClient);

    expect(result.ok).toBe(false);
    expect(result.message).toBe("请求失败: socket hang up");
  });
});

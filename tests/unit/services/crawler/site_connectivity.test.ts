import { probeSiteConnectivity, resolveSiteConnectivityTargetUrl } from "@mdcz/runtime/crawler";
import { type Configuration, defaultConfiguration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it, vi } from "vitest";

const createConfiguration = (): Configuration => structuredClone(defaultConfiguration);

describe("siteConnectivity", () => {
  it("uses the built-in site origin", () => {
    expect(resolveSiteConnectivityTargetUrl(Website.AVBASE)).toBe("https://www.avbase.net");
    expect(resolveSiteConnectivityTargetUrl(Website.DMM_TV)).toBe("https://video.dmm.co.jp/");
    expect(resolveSiteConnectivityTargetUrl(Website.H0930)).toBe("https://www.h0930.com");
    expect(resolveSiteConnectivityTargetUrl(Website.H4610)).toBe("https://www.h4610.com");
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

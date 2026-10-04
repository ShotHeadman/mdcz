import { probeSiteConnectivity, resolveSiteConnectivityTargetUrl } from "@mdcz/runtime/crawler";
import { type Configuration, defaultConfiguration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it, vi } from "vitest";

const createConfiguration = (): Configuration => structuredClone(defaultConfiguration);

describe("siteConnectivity", () => {
  it("probes built-in origins and the search page of official or mirror JavDB and JavBus", () => {
    const configuration = createConfiguration();
    configuration.network.javdbUrl = "https://javdb571.com/zh";
    expect(resolveSiteConnectivityTargetUrl(Website.AVBASE, configuration)).toBe("https://www.avbase.net");
    expect(resolveSiteConnectivityTargetUrl(Website.DMM_TV, configuration)).toBe("https://video.dmm.co.jp/");
    expect(resolveSiteConnectivityTargetUrl(Website.JAVBUS, configuration)).toBe(
      "https://www.javbus.com/search/ABP-001",
    );
    expect(resolveSiteConnectivityTargetUrl(Website.JAVDB, configuration)).toBe(
      "https://javdb571.com/search?q=ABP-001",
    );
  });

  it("formats probe results and rejects mirrors that redirect to another host", async () => {
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
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(networkClient.probe).toHaveBeenCalledWith(
      "https://www.avbase.net",
      expect.objectContaining({ timeout: 10000 }),
    );

    configuration.network.javdbUrl = "https://javdb36.com";
    networkClient.probe.mockResolvedValue({
      ok: true,
      status: 200,
      contentLength: null,
      resolvedUrl: "https://expireddomains.com/domain/javdb36.com",
    });
    await expect(probeSiteConnectivity(Website.JAVDB, configuration, networkClient)).resolves.toMatchObject({
      ok: false,
      status: 200,
      redirectedHost: "expireddomains.com",
    });
  });

  it("returns the request error when the probe throws", async () => {
    const configuration = createConfiguration();
    const networkClient = {
      probe: vi.fn().mockRejectedValue(new Error("socket hang up")),
    };

    const result = await probeSiteConnectivity(Website.JAVBUS, configuration, networkClient);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("socket hang up");
  });
});

import { describe, expect, it, vi } from "vitest";
import type { NetworkCookieJar, NetworkSession } from "../network";
import type { AmazonJpNetworkClient } from "./AmazonJpImageService";
import { lookupAmazonPoster } from "./amazonPoster";

describe("lookupAmazonPoster", () => {
  it("uses the shared high-quality Amazon lookup with a cookie session and isolates failed probes", async () => {
    const firstImage = "https://m.media-amazon.com/images/I/first._AC_US40_.jpg";
    const expectedImage = "https://m.media-amazon.com/images/I/second._AC_SL1500_.jpg";
    const sessionUrls: string[] = [];
    const createSession = vi.fn(
      (_options?: { cookieJar?: NetworkCookieJar }): NetworkSession => ({
        getText: async (url) => {
          sessionUrls.push(url);
          const path = new URL(url).pathname;
          if (path.includes("black-curtain")) {
            return `
              <div data-component-type="s-search-result" data-asin="B000TEST01">
                <h2><a href="/dp/B000TEST01"><span>原題</span></a></h2>
              </div>
              <div data-component-type="s-search-result" data-asin="B000TEST02">
                <h2><a href="/dp/B000TEST02"><span>原題</span></a></h2>
              </div>
            `;
          }
          if (path === "/dp/B000TEST01") return `<img id="landingImage" src="${firstImage}" />`;
          if (path === "/dp/B000TEST02") {
            return `<img id="landingImage" src="https://m.media-amazon.com/images/I/second._AC_US40_.jpg"
              data-a-dynamic-image='{"${expectedImage}":[1500,2100]}' />`;
          }
          throw new Error(`Unexpected URL: ${url}`);
        },
      }),
    );
    const head = vi
      .fn()
      .mockRejectedValueOnce(new Error("probe failed"))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const networkClient = { createSession, head } as unknown as AmazonJpNetworkClient;

    const result = await lookupAmazonPoster(networkClient, "/library/ABC-123.nfo", "原題");

    expect(result.amazonPosterUrl).toBe(expectedImage);
    expect(createSession).toHaveBeenCalledOnce();
    expect(createSession.mock.calls[0]?.[0]?.cookieJar).toBeDefined();
    expect(sessionUrls).toHaveLength(3);
    expect(head).toHaveBeenCalledTimes(2);
  });
});

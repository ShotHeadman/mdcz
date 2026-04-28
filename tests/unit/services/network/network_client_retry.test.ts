import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock, sleepMock, impitConstructorMock } = vi.hoisted(() => {
  const fetchMock = vi.fn();
  const sleepMock = vi.fn().mockResolvedValue(undefined);
  const impitConstructorMock = vi.fn();
  return { fetchMock, sleepMock, impitConstructorMock };
});

vi.mock("node:timers/promises", () => {
  return {
    setTimeout: sleepMock,
  };
});

import { CrawlerProvider } from "@main/services/crawler/CrawlerProvider";
import { FetchGateway } from "@main/services/crawler/FetchGateway";
import { NetworkClient } from "@main/services/network/NetworkClient";

const createProbeResponse = (
  body: Uint8Array,
  init: {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    url?: string;
  } = {},
) => {
  const bytes = vi.fn(async () => body);
  return {
    response: {
      status: init.status ?? 200,
      ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
      statusText: init.statusText ?? "",
      headers: new Headers(init.headers),
      url: init.url ?? "https://example.com/poster.jpg",
      bytes,
    } as unknown as Response,
    bytes,
  };
};

const JPEG_PROBE_BYTES = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x38, 0x07, 0x80, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11,
  0x01, 0xff, 0xd9,
]);
const WEBP_PROBE_BYTES = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x16, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 0x0a, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x7f, 0x02, 0x00, 0x67, 0x01, 0x00,
]);

describe("NetworkClient retry policy", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        __mdczImpitMock?: { fetch: typeof fetchMock; constructorSpy: typeof impitConstructorMock };
      }
    ).__mdczImpitMock = {
      fetch: fetchMock,
      constructorSpy: impitConstructorMock,
    };
    fetchMock.mockReset();
    sleepMock.mockClear();
    impitConstructorMock.mockClear();
  });

  it("does not retry unretryable failures", async () => {
    const cases = [
      {
        setup: () => {
          fetchMock.mockResolvedValueOnce(
            new Response("blocked", {
              status: 403,
              statusText: "Forbidden",
            }),
          );
        },
        expectedError: "HTTP 403",
      },
      {
        setup: () => {
          fetchMock.mockResolvedValueOnce(
            new Response("rate-limited", {
              status: 429,
              statusText: "Too Many Requests",
            }),
          );
        },
        expectedError: "HTTP 429",
      },
      {
        setup: () => {
          fetchMock.mockRejectedValueOnce(new Error("socket hang up"));
        },
        expectedError: "socket hang up",
      },
    ];

    for (const { setup, expectedError } of cases) {
      fetchMock.mockReset();
      sleepMock.mockClear();
      setup();

      const client = new NetworkClient();
      await expect(client.getText("https://example.com/failure")).rejects.toThrow(expectedError);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sleepMock).not.toHaveBeenCalled();
    }
  });

  it("retries supported throttling and transient server failures", async () => {
    const cases = [
      {
        setup: () => {
          fetchMock
            .mockResolvedValueOnce(
              new Response("rate-limited", {
                status: 429,
                statusText: "Too Many Requests",
                headers: {
                  "Retry-After": "60",
                },
              }),
            )
            .mockResolvedValueOnce(
              new Response("ok", {
                status: 200,
              }),
            );
        },
        client: () => new NetworkClient(),
        expectedBody: "ok",
        expectedSleepCalls: [15_000],
        expectedFetchCalls: 2,
      },
      {
        setup: () => {
          fetchMock
            .mockResolvedValueOnce(
              new Response("temporary-down-1", {
                status: 503,
                statusText: "Service Unavailable",
              }),
            )
            .mockResolvedValueOnce(
              new Response("temporary-down-2", {
                status: 503,
                statusText: "Service Unavailable",
              }),
            )
            .mockResolvedValueOnce(
              new Response("ok", {
                status: 200,
              }),
            );
        },
        client: () =>
          new NetworkClient({
            getRetryCount: () => 2,
          }),
        expectedBody: "ok",
        expectedSleepCalls: [1_000, 2_000],
        expectedFetchCalls: 3,
      },
    ];

    for (const { setup, client, expectedBody, expectedSleepCalls, expectedFetchCalls } of cases) {
      fetchMock.mockReset();
      sleepMock.mockClear();
      setup();

      await expect(client().getText("https://example.com/retryable")).resolves.toBe(expectedBody);

      expect(fetchMock).toHaveBeenCalledTimes(expectedFetchCalls);
      expect(sleepMock).toHaveBeenCalledTimes(expectedSleepCalls.length);
      expectedSleepCalls.forEach((delay, index) => {
        expect(sleepMock).toHaveBeenNthCalledWith(index + 1, delay);
      });
    }
  });

  it("captures image dimensions from ranged probes", async () => {
    const cases = [
      {
        setup: () => {
          const { response: initialResponse } = createProbeResponse(JPEG_PROBE_BYTES.subarray(0, 20), {
            status: 206,
            headers: {
              "Content-Type": "image/jpeg",
              "Content-Length": "20",
              "Content-Range": "bytes 0-19/123456",
            },
          });
          const { response: retryResponse } = createProbeResponse(JPEG_PROBE_BYTES, {
            status: 206,
            headers: {
              "Content-Type": "image/jpeg",
              "Content-Length": String(JPEG_PROBE_BYTES.length),
              "Content-Range": `bytes 0-${JPEG_PROBE_BYTES.length - 1}/123456`,
            },
          });
          fetchMock.mockResolvedValueOnce(initialResponse).mockResolvedValueOnce(retryResponse);
        },
        url: "https://example.com/poster.jpg",
        expectedResult: {
          ok: true,
          status: 206,
          contentLength: 123456,
          width: 1920,
          height: 1080,
        },
        expectedRanges: ["bytes=0-65535", "bytes=0-262143"],
      },
      {
        setup: () => {
          const { response } = createProbeResponse(WEBP_PROBE_BYTES, {
            status: 200,
            headers: {
              "Content-Type": "image/webp",
              "Content-Length": String(WEBP_PROBE_BYTES.length),
            },
          });
          fetchMock.mockResolvedValueOnce(response);
        },
        url: "https://example.com/poster.webp",
        expectedResult: {
          ok: true,
          status: 200,
          contentLength: WEBP_PROBE_BYTES.length,
          width: 640,
          height: 360,
        },
        expectedRanges: ["bytes=0-65535"],
      },
    ];

    for (const { setup, url, expectedResult, expectedRanges } of cases) {
      fetchMock.mockReset();
      sleepMock.mockClear();
      setup();

      const client = new NetworkClient();
      await expect(client.probe(url, { captureImageSize: true })).resolves.toMatchObject(expectedResult);

      expect(fetchMock).toHaveBeenCalledTimes(expectedRanges.length);
      expectedRanges.forEach((range, index) => {
        expect(fetchMock.mock.calls[index]?.[1]?.method).toBe("GET");
        expect(new Headers(fetchMock.mock.calls[index]?.[1]?.headers).get("range")).toBe(range);
      });
    }
  });

  it("reuses a shared Impit client until proxy settings change", async () => {
    let proxyUrl = "http://proxy-a";
    fetchMock.mockImplementation(async () => new Response("ok", { status: 200 }));
    const client = new NetworkClient({
      getProxyUrl: () => proxyUrl,
    });

    await expect(client.getText("https://example.com/one")).resolves.toBe("ok");
    await expect(client.getText("https://example.com/two")).resolves.toBe("ok");

    expect(impitConstructorMock).toHaveBeenCalledTimes(1);
    expect(impitConstructorMock.mock.calls[0]?.[0]).toMatchObject({
      proxyUrl: "http://proxy-a",
    });

    proxyUrl = "http://proxy-b";
    await expect(client.getText("https://example.com/three")).resolves.toBe("ok");

    expect(impitConstructorMock).toHaveBeenCalledTimes(2);
    expect(impitConstructorMock.mock.calls[1]?.[0]).toMatchObject({
      proxyUrl: "http://proxy-b",
    });
  });

  it("applies crawler-registered site request defaults without overriding explicit headers", async () => {
    fetchMock.mockImplementation(async () => new Response("ok", { status: 200 }));
    const client = new NetworkClient();
    new CrawlerProvider({
      fetchGateway: new FetchGateway(client),
      siteRequestConfigRegistrar: client,
    });

    await expect(client.getText("https://www.javbus.com/search/ABP-123")).resolves.toBe("ok");

    const defaultHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(defaultHeaders.get("referer")).toBe("https://www.javbus.com/");
    expect(defaultHeaders.get("accept-language")).toContain("zh-CN");

    fetchMock.mockClear();
    await expect(
      client.getText("https://www.javbus.com/search/ABP-123", {
        headers: {
          referer: "https://custom.example/",
        },
      }),
    ).resolves.toBe("ok");

    const explicitHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(explicitHeaders.get("referer")).toBe("https://custom.example/");
    expect(explicitHeaders.get("accept-language")).toContain("zh-CN");

    fetchMock.mockClear();
    await expect(client.getText("https://pics.javbus.com/sample.jpg")).resolves.toBe("ok");

    const subdomainHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(subdomainHeaders.get("referer")).toBe("https://www.javbus.com/");
    expect(subdomainHeaders.get("accept-language")).toContain("zh-CN");
  });
});

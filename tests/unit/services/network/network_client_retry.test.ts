import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock, sleepMock } = vi.hoisted(() => {
  const fetchMock = vi.fn();
  const sleepMock = vi.fn().mockResolvedValue(undefined);
  return { fetchMock, sleepMock };
});

vi.mock("impit", () => {
  return {
    Impit: class {
      fetch = fetchMock;
    },
  };
});

vi.mock("node:timers/promises", () => {
  return {
    setTimeout: sleepMock,
  };
});

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
    fetchMock.mockReset();
    sleepMock.mockClear();
  });

  it("does not retry non-429 responses", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("blocked", {
        status: 403,
        statusText: "Forbidden",
      }),
    );

    const client = new NetworkClient();
    await expect(client.getText("https://example.com/blocked")).rejects.toThrow("HTTP 403");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("retries once for 429 when Retry-After exists and caps wait at 15s", async () => {
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

    const client = new NetworkClient();
    await expect(client.getText("https://example.com/rate-limited")).resolves.toBe("ok");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).toHaveBeenCalledWith(15_000);
  });

  it("does not retry 429 without Retry-After", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("rate-limited", {
        status: 429,
        statusText: "Too Many Requests",
      }),
    );

    const client = new NetworkClient();
    await expect(client.getText("https://example.com/rate-limited")).rejects.toThrow("HTTP 429");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("does not retry thrown request errors", async () => {
    fetchMock.mockRejectedValueOnce(new Error("socket hang up"));

    const client = new NetworkClient();
    await expect(client.getText("https://example.com/unreachable")).rejects.toThrow("socket hang up");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("retries retryable 5xx responses based on configured retry count", async () => {
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

    const client = new NetworkClient({
      getRetryCount: () => 2,
    });
    await expect(client.getText("https://example.com/transient-503")).resolves.toBe("ok");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleepMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenNthCalledWith(1, 1000);
    expect(sleepMock).toHaveBeenNthCalledWith(2, 2000);
  });

  it("captures image dimensions from a direct ranged GET and retries with a larger JPEG probe window when needed", async () => {
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

    const client = new NetworkClient();
    await expect(client.probe("https://example.com/poster.jpg", { captureImageSize: true })).resolves.toMatchObject({
      ok: true,
      status: 206,
      contentLength: 123456,
      width: 1920,
      height: 1080,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("GET");
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("range")).toBe("bytes=0-65535");
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("GET");
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("range")).toBe("bytes=0-262143");
  });

  it("captures image dimensions from a WebP probe response without a JPEG retry", async () => {
    const { response } = createProbeResponse(WEBP_PROBE_BYTES, {
      status: 200,
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(WEBP_PROBE_BYTES.length),
      },
    });
    fetchMock.mockResolvedValueOnce(response);

    const client = new NetworkClient();
    await expect(client.probe("https://example.com/poster.webp", { captureImageSize: true })).resolves.toMatchObject({
      ok: true,
      status: 200,
      contentLength: WEBP_PROBE_BYTES.length,
      width: 640,
      height: 360,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("range")).toBe("bytes=0-65535");
  });
});

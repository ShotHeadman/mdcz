import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, resolveDefaultApiBase, setAdminToken } from "./client";

describe("web api client", () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  const storage = new Map<string, string>();
  const fetchMock = vi.fn();

  beforeEach(() => {
    storage.clear();
    fetchMock.mockReset();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => {
          storage.delete(key);
        },
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
      },
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchMock,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    });
  });

  it("sends typed tRPC calls for config calls without an explicit path", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ result: { data: {} } }), { status: 200 }));

    await api.config.read();
    await api.config.reset();

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:3838/trpc/config.read");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({});
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://127.0.0.1:3838/trpc/config.reset");
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("POST");
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({});
  });

  it("adds the bearer token to tRPC requests", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ result: { data: {} } }), { status: 200 }));
    setAdminToken("token-1");

    await api.health.read();

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer token-1",
    });
  });

  it("uses the serving origin for packaged WebUI API calls", () => {
    expect(
      resolveDefaultApiBase({
        development: false,
        location: { hostname: "127.0.0.1", origin: "http://127.0.0.1:8767", protocol: "http:" },
      }),
    ).toBe("http://127.0.0.1:8767");
  });

  it("keeps the Server port while running through the Vite development origin", () => {
    expect(
      resolveDefaultApiBase({
        development: true,
        location: { hostname: "192.0.2.10", origin: "http://192.0.2.10:5173", protocol: "http:" },
      }),
    ).toBe("http://192.0.2.10:3838");
  });

  it("prefers an explicitly configured API base", () => {
    expect(resolveDefaultApiBase({ configuredBase: "https://api.example.test/", development: false })).toBe(
      "https://api.example.test",
    );
  });
});

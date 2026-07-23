import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, resolveDefaultApiBase, setAdminToken, setApiBase } from "./client";

describe("web api client", () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  const originalLocation = globalThis.location;
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
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: undefined,
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
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("sends typed tRPC requests with the bearer token", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ result: { data: {} } }), { status: 200 }));
    setAdminToken("token-1");

    await api.config.read();

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:3838/trpc/config.read");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer token-1",
    });
  });

  it("uses the remote host with the server port for development login requests", async () => {
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: {
        hostname: "192.0.2.10",
        origin: "http://192.0.2.10:8767",
        protocol: "http:",
      },
    });
    setApiBase("");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ result: { data: { token: "token-remote" } } }), { status: 200 }),
    );

    await api.auth.login({ password: "admin" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://192.0.2.10:3838/trpc/auth.login");
  });

  it("resolves production, development, configured, and no-location API bases", () => {
    expect(
      resolveDefaultApiBase({
        development: false,
        location: { hostname: "192.0.2.10", origin: "http://192.0.2.10:8767", protocol: "http:" },
      }),
    ).toBe("http://192.0.2.10:8767");
    expect(
      resolveDefaultApiBase({
        development: true,
        location: { hostname: "192.0.2.10", origin: "http://192.0.2.10:5173", protocol: "http:" },
      }),
    ).toBe("http://192.0.2.10:3838");
    expect(resolveDefaultApiBase({ configuredBase: "https://api.example.test/", development: false })).toBe(
      "https://api.example.test",
    );
    expect(resolveDefaultApiBase({ location: undefined })).toBe("http://127.0.0.1:3838");
  });
});

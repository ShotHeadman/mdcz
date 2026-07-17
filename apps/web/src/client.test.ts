import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, setAdminToken } from "./client";

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

  it("sends typed tRPC requests with the bearer token", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ result: { data: {} } }), { status: 200 }));
    setAdminToken("token-1");

    await api.config.read();

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:3838/trpc/config.read");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer token-1",
    });
  });
});

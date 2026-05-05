import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./client";

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

  it("sends object input for config calls without an explicit path", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ result: { data: {} } }), { status: 200 }));

    await api.config.read();
    await api.config.reset();

    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({});
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({});
  });
});

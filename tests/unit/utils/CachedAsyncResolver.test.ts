import { CachedAsyncResolver } from "@mdcz/runtime/shared";
import { describe, expect, it } from "vitest";

describe("CachedAsyncResolver", () => {
  it("caches resolved values", async () => {
    const resolver = new CachedAsyncResolver<string, number>();
    let callCount = 0;
    const fetcher = async (key: string) => {
      callCount += 1;
      return key.length;
    };

    const first = await resolver.resolve("hello", fetcher);
    const second = await resolver.resolve("hello", fetcher);

    expect(first).toBe(5);
    expect(second).toBe(5);
    expect(callCount).toBe(1);
  });

  it("does not share cache between different keys", async () => {
    const resolver = new CachedAsyncResolver<string, number>();
    const fetcher = async (key: string) => key.length;

    expect(await resolver.resolve("a", fetcher)).toBe(1);
    expect(await resolver.resolve("ab", fetcher)).toBe(2);
  });

  it("deduplicates concurrent requests for the same key", async () => {
    const resolver = new CachedAsyncResolver<string, string>();
    let callCount = 0;

    const slowFetcher = async (key: string) => {
      callCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return `result-${key}`;
    };

    const [a, b, c] = await Promise.all([
      resolver.resolve("key1", slowFetcher),
      resolver.resolve("key1", slowFetcher),
      resolver.resolve("key1", slowFetcher),
    ]);

    expect(a).toBe("result-key1");
    expect(b).toBe("result-key1");
    expect(c).toBe("result-key1");
    expect(callCount).toBe(1);
  });

  it("handles resolver errors without poisoning cache", async () => {
    const resolver = new CachedAsyncResolver<string, string>();
    let attempt = 0;

    const flakeyFetcher = async (key: string) => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("transient failure");
      }
      return `ok-${key}`;
    };

    await expect(resolver.resolve("k", flakeyFetcher)).rejects.toThrow("transient failure");

    // After failure, the key should not be cached — retry should succeed
    const result = await resolver.resolve("k", flakeyFetcher);
    expect(result).toBe("ok-k");
  });
});

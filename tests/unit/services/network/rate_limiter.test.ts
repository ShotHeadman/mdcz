import { RateLimiter } from "@mdcz/runtime/network";
import { describe, expect, it, vi } from "vitest";

const getQueueCount = (limiter: RateLimiter): number => {
  return (limiter as unknown as { queues: Map<string, unknown> }).queues.size;
};

describe("RateLimiter", () => {
  it("evicts idle per-domain queues after the ttl", async () => {
    vi.useFakeTimers();

    const limiter = new RateLimiter(5, 1_000);

    await expect(limiter.schedule("https://images.example.com/poster.jpg", async () => "ok")).resolves.toBe("ok");
    expect(getQueueCount(limiter)).toBe(1);

    vi.advanceTimersByTime(999);
    expect(getQueueCount(limiter)).toBe(1);

    vi.advanceTimersByTime(1);
    expect(getQueueCount(limiter)).toBe(0);

    vi.useRealTimers();
  });

  it("keeps pacing a domain when its unchanged limit is applied again", async () => {
    vi.useFakeTimers();

    const limiter = new RateLimiter(5, 0);
    const started: string[] = [];
    limiter.setDomainInterval("javdb.com", 3_000);
    await limiter.schedule("https://javdb.com/a", async () => started.push("a"));
    limiter.setDomainInterval("javdb.com", 3_000);
    const second = limiter.schedule("https://javdb.com/b", async () => started.push("b"));

    await vi.advanceTimersByTimeAsync(2_999);
    expect(started).toEqual(["a"]);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(started).toEqual(["a", "b"]);

    vi.useRealTimers();
  });
});

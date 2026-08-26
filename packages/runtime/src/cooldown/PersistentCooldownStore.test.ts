import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createTempDirectory } from "../../../../tests/harness/tempDirectory";
import { ImageHostCooldownTracker, MemoryImageHostCooldownStore } from "../scrape/download/ImageHostCooldownTracker";
import { PersistentCooldownStore } from "./PersistentCooldownStore";

describe("PersistentCooldownStore", () => {
  it("persists active cooldowns and restores them in another host process", async () => {
    const directory = await createTempDirectory("runtime-cooldown");
    const filePath = join(directory.path, "cooldowns.json");
    const store = new PersistentCooldownStore({ filePath, persistDelayMs: 0 });

    store.recordFailure("images.example.com", { threshold: 1, windowMs: 60_000, cooldownMs: 60_000 });
    await store.flush();

    expect(JSON.parse(await readFile(filePath, "utf8"))).toHaveProperty("images.example.com");
    const restored = new PersistentCooldownStore({ filePath });
    expect(restored.getActiveCooldown("images.example.com")?.remainingMs).toBeGreaterThan(0);
    await directory.cleanup();
  });
});

describe("ImageHostCooldownTracker", () => {
  it("ignores transport failures and opens cooldown only after three retryable HTTP failures", () => {
    const store = new MemoryImageHostCooldownStore();
    const logger = { info: vi.fn(), warn: vi.fn() };
    const tracker = new ImageHostCooldownTracker(store, logger);
    const url = "https://images.example.com/poster.jpg";

    tracker.recordFailure(url, "TLS handshake EOF");
    tracker.recordFailure(url, "Request timeout (10000 ms) exceeded");
    tracker.recordFailure(url, "connection reset");
    expect(tracker.shouldSkipUrl(url)).toBe(false);

    tracker.recordFailure(url, "HTTP 408", 408);
    tracker.recordFailure(url, "HTTP 429", 429);
    expect(tracker.shouldSkipUrl(url)).toBe(false);

    tracker.recordFailure(url, "HTTP 503", 503);
    expect(tracker.shouldSkipUrl(url)).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("after 3 failures"));
  });

  it("resetAll clears cooldown state and skip-log deduplication", () => {
    const store = new MemoryImageHostCooldownStore();
    const logger = { info: vi.fn(), warn: vi.fn() };
    const tracker = new ImageHostCooldownTracker(store, logger);
    const url = "https://images.example.com/poster.jpg";

    for (let attempt = 0; attempt < 3; attempt += 1) {
      tracker.recordFailure(url, "HTTP 503", 503);
    }
    expect(tracker.shouldSkipUrl(url)).toBe(true);

    tracker.resetAll();
    expect(tracker.shouldSkipUrl(url)).toBe(false);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      tracker.recordFailure(url, "HTTP 503", 503);
    }
    expect(tracker.shouldSkipUrl(url)).toBe(true);
    expect(logger.warn.mock.calls.filter(([message]) => String(message).startsWith("Skipping "))).toHaveLength(2);
  });
});

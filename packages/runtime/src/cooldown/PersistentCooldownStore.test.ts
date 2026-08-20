import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTempDirectory } from "../../../../tests/harness/tempDirectory";
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

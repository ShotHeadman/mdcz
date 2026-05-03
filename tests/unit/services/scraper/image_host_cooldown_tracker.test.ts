import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersistentCooldownStore } from "@main/services/cooldown/PersistentCooldownStore";
import { ImageHostCooldownTracker } from "@mdcz/runtime/scrape";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-image-host-cooldown-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const createTracker = async () => {
  const root = await createTempDir();
  const store = new PersistentCooldownStore({
    filePath: join(root, "image-host-cooldowns.json"),
    loggerName: "ImageHostCooldownTrackerTestStore",
  });
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
  };

  return {
    store,
    logger,
    tracker: new ImageHostCooldownTracker(store, logger),
  };
};

describe("ImageHostCooldownTracker", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map(async (dirPath) => {
        await rm(dirPath, { recursive: true, force: true });
      }),
    );
  });

  it("opens cooldowns only for retryable failures and logs the skip once per window", async () => {
    const { store, logger, tracker } = await createTracker();
    const cooledUrl = "https://img.example.com/a.jpg";
    const otherUrl = "https://other.example.com/b.jpg";

    tracker.recordFailure(cooledUrl, "HTTP 404", 404);
    expect(store.isCoolingDown("img.example.com")).toBe(false);

    tracker.recordFailure(cooledUrl, "HTTP 429", 429);
    expect(store.isCoolingDown("img.example.com")).toBe(false);

    tracker.recordFailure(cooledUrl, "HTTP 429", 429);
    expect(store.isCoolingDown("img.example.com")).toBe(true);

    expect(tracker.filterUrls([cooledUrl, otherUrl])).toEqual([otherUrl]);
    expect(logger.info).toHaveBeenCalledTimes(1);

    expect(tracker.filterUrls([cooledUrl])).toEqual([]);
    expect(logger.info).toHaveBeenCalledTimes(1);

    await store.flush();
  });

  it("resets active cooldowns and ignores invalid URLs", async () => {
    const { store, tracker } = await createTracker();
    const url = "https://img.example.com/a.jpg";

    tracker.recordFailure("not-a-url", "HTTP 503", 503);
    expect(store.isCoolingDown("not-a-url")).toBe(false);

    tracker.recordFailure(url, "HTTP 503", 503);
    tracker.recordFailure(url, "HTTP 503", 503);
    expect(store.isCoolingDown("img.example.com")).toBe(true);

    tracker.reset(url);
    expect(store.isCoolingDown("img.example.com")).toBe(false);

    await store.flush();
  });
});

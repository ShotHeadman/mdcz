import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScrapeSession } from "@main/services/scraper/session/ScrapeSession";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-scrape-session-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const waitFor = async (predicate: () => Promise<boolean>, timeoutMs = 1000): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error("Timed out waiting for session state");
};

describe("ScrapeSession", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
    );
  });

  it("persists a recoverable snapshot as soon as the session starts", async () => {
    const dirPath = await createTempDir();
    const statePath = join(dirPath, "session-state.json");
    const session = new ScrapeSession({ statePath, persistIntervalMs: 50 });

    session.begin(["/tmp/ABP-123.mp4"], 1);

    await waitFor(async () => await session.hasRecoverableSession());

    await expect(readFile(statePath, "utf8")).resolves.toContain("ABP-123.mp4");
    await expect(session.getRecoverableSnapshot()).resolves.toMatchObject({
      pendingFiles: ["/tmp/ABP-123.mp4"],
      failedFiles: [],
      status: {
        state: "running",
        running: true,
      },
    });

    await session.finish();
    await waitFor(async () => {
      try {
        await readFile(statePath, "utf8");
        return false;
      } catch {
        return true;
      }
    });
  });

  it("can discard a persisted recoverable snapshot before resuming", async () => {
    const dirPath = await createTempDir();
    const statePath = join(dirPath, "session-state.json");
    await writeFile(
      statePath,
      JSON.stringify(
        {
          taskId: "task-1",
          status: {
            state: "running",
            running: true,
            totalFiles: 1,
            completedFiles: 0,
            successCount: 0,
            failedCount: 0,
            skippedCount: 0,
          },
          failedFiles: [],
          pendingFiles: ["/tmp/ABP-123.mp4"],
        },
        null,
        2,
      ),
      "utf8",
    );

    const restored = new ScrapeSession({ statePath, persistIntervalMs: 50 });
    await restored.discardRecoverableSession();

    await expect(restored.hasRecoverableSession()).resolves.toBe(false);
    await expect(readFile(statePath, "utf8")).rejects.toThrow();
  });
});

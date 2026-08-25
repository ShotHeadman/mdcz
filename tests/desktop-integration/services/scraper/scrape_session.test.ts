import { MAX_LIVE_SCRAPE_LOGS, type ScrapeRunItem, ScrapeRunSession } from "@mdcz/runtime/tasks";
import { Website } from "@mdcz/shared/enums";
import type { ScrapeResult } from "@mdcz/shared/types";
import { describe, expect, it } from "vitest";

const item = (id: string): ScrapeRunItem => ({
  id,
  rootId: "root-1",
  relativePath: `${id}.mp4`,
  sourcePath: `/media/${id}.mp4`,
  attempt: 1,
});

const result = (current: ScrapeRunItem, status: "success" | "failed" | "skipped" = "success"): ScrapeResult => ({
  status,
  fileId: current.id,
  fileInfo: {
    filePath: current.sourcePath,
    fileName: `${current.id}.mp4`,
    extension: ".mp4",
    number: current.id,
    isSubtitled: false,
  },
  ...(status === "success"
    ? {
        crawlerData: {
          title: current.id,
          number: current.id,
          actors: [],
          genres: [],
          scene_images: [],
          website: Website.JAVDB,
        },
      }
    : status === "failed"
      ? { error: "failed" }
      : {}),
});

describe("ScrapeRunSession desktop contract", () => {
  it("keeps stable run and item IDs while exposing committed terminal results", async () => {
    const items = [item("one"), item("two")];
    const observedStatuses: string[] = [];
    const session = new ScrapeRunSession({
      runId: "run-1",
      items,
      concurrency: 2,
      executeItem: async (current) => result(current, current.id === "one" ? "success" : "failed"),
      commitItem: async (current, terminal) => ({
        ...terminal,
        resultId: `${current.id}:attempt-${current.attempt}`,
      }),
      onSnapshot: (snapshot) => {
        observedStatuses.push(snapshot.status);
      },
    });

    await session.start();
    await session.waitForIdle();

    expect(session.snapshot()).toMatchObject({
      runId: "run-1",
      generation: 0,
      status: "completed",
      progress: { percent: 100, completedItems: 2, totalItems: 2 },
      items: [
        { id: "one", attempt: 1, status: "success", result: { resultId: "one:attempt-1" } },
        { id: "two", attempt: 1, status: "failed", result: { resultId: "two:attempt-1" } },
      ],
    });
    expect(observedStatuses[0]).toBe("running");
    expect(observedStatuses.at(-1)).toBe("completed");
  });

  it("retains only the latest bounded live logs and associates stages with stable items", () => {
    const current = item("one");
    const session = new ScrapeRunSession({
      runId: "run-1",
      items: [current],
      concurrency: 1,
      executeItem: async () => result(current),
      commitItem: async (_item, terminal) => terminal,
      onSnapshot: () => undefined,
    });

    session.recordStage({ stage: "Download", message: "Downloading", itemId: current.id });
    for (let index = 0; index <= MAX_LIVE_SCRAPE_LOGS; index += 1) {
      session.recordLog({ level: "info", message: `log-${index}`, itemId: current.id });
    }

    expect(session.snapshot()).toMatchObject({
      latestStage: {
        stage: "Download",
        message: "Downloading",
        itemId: "one",
        relativePath: "one.mp4",
      },
      logs: [
        { message: "log-1", itemId: "one", relativePath: "one.mp4" },
        ...Array.from({ length: MAX_LIVE_SCRAPE_LOGS - 2 }, () => expect.any(Object)),
        { message: `log-${MAX_LIVE_SCRAPE_LOGS}`, itemId: "one", relativePath: "one.mp4" },
      ],
    });
  });
});

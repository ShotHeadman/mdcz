import { InMemoryScrapeSessionExecutionStore, ScrapeSession } from "@mdcz/runtime/tasks";
import { Website } from "@mdcz/shared/enums";
import type { ScrapeResult } from "@mdcz/shared/types";
import { describe, expect, it } from "vitest";

const result = (sourcePath: string, status: ScrapeResult["status"] = "success"): ScrapeResult => ({
  status,
  fileId: sourcePath,
  fileInfo: { filePath: sourcePath, fileName: sourcePath, extension: ".mp4", number: "TEST-001", isSubtitled: false },
  ...(status === "success"
    ? {
        crawlerData: {
          title: "Test",
          number: "TEST-001",
          actors: [],
          genres: [],
          scene_images: [],
          website: Website.JAVDB,
        },
      }
    : {}),
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

describe("ScrapeSession", () => {
  it("pauses after the in-flight item settles and resumes only pending work", async () => {
    const session = new ScrapeSession({ executionStore: new InMemoryScrapeSessionExecutionStore() });
    const first = deferred<ScrapeResult>();
    const started: string[] = [];
    await session.begin(["one", "two", "three"], 1);
    await session.addTask({
      sourcePath: "one",
      isRetry: false,
      taskFn: async () => {
        started.push("one");
        return first.promise;
      },
    });
    await session.addTask({
      sourcePath: "two",
      isRetry: false,
      taskFn: async () => {
        started.push("two");
        return result("two");
      },
    });
    await session.addTask({
      sourcePath: "three",
      isRetry: false,
      taskFn: async () => {
        started.push("three");
        return result("three");
      },
    });
    const idle = session.onIdle();
    while (started.length !== 1) await new Promise((resolve) => setTimeout(resolve, 1));
    await session.pause();
    first.resolve(result("one"));
    await idle;
    expect(session.getState()).toBe("paused");
    expect(started).toEqual(["one"]);
    await session.resume();
    await session.onIdle();
    expect(started).toEqual(["one", "two", "three"]);
  });

  it("stops pending work without allowing a cleared worker to start it", async () => {
    const session = new ScrapeSession({ executionStore: new InMemoryScrapeSessionExecutionStore() });
    const running = deferred<ScrapeResult>();
    const started: string[] = [];
    await session.begin(["one", "two"], 1);
    await session.addTask({
      sourcePath: "one",
      isRetry: false,
      taskFn: async () => {
        started.push("one");
        return running.promise;
      },
    });
    await session.addTask({
      sourcePath: "two",
      isRetry: false,
      taskFn: async () => {
        started.push("two");
        return result("two");
      },
    });
    const idle = session.onIdle();
    while (started.length !== 1) await new Promise((resolve) => setTimeout(resolve, 1));
    await session.stop();
    running.resolve(result("one"));
    await idle;
    expect(started).toEqual(["one"]);
    expect(session.getStatus().skippedCount).toBe(1);
  });
});
